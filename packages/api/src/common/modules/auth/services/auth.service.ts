import nicknameData from "@assets/nickname.json";
import { BaseService } from "@buildingai/base";
import { BusinessCode } from "@buildingai/constants/shared/business-code.constant";
import {
    BooleanNumber,
    UserCreateSource,
    UserTerminal,
    UserTerminalType,
} from "@buildingai/constants/shared/status-codes.constant";
import { checkUserLoginPlayground } from "@buildingai/db";
import { LoginUserPlayground, UserPlayground } from "@buildingai/db";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { Department, DepartmentUserIndex, User, UserToken } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { HttpErrorFactory } from "@buildingai/errors";
import { generateNo } from "@buildingai/utils";
import { isDisabled } from "@buildingai/utils";
import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { isEmail, isMobilePhone } from "class-validator";

import { RegisterDto } from "../dto/register.dto";
import { AdAuthService, AdUserInfo } from "./ad-auth.service";
import { RolePermissionService } from "./role-permission.service";
import { UserTokenService } from "./user-token.service";

/**
 * 认证服务
 *
 * 处理用户认证、令牌生成等功能
 */
@Injectable()
export class AuthService extends BaseService<User> {
    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,
        private rolePermissionService: RolePermissionService,
        public userTokenService: UserTokenService,
        private adAuthService: AdAuthService,
        @InjectRepository(DepartmentUserIndex)
        private readonly departmentUserIndexRepository: Repository<DepartmentUserIndex>,
        @InjectRepository(Department)
        private readonly departmentRepository: Repository<Department>,
    ) {
        super(userRepository);
    }

    async checkAccount(account: string) {
        const res = {
            hasAccount: false,
            type: "",
            hasPassword: false,
        };
        const accountData = await this.userRepository.findOne({
            where: [{ username: account }, { email: account }, { phone: account }],
            select: ["username", "email", "phone", "password"],
        });
        if (!accountData) {
            return res;
        }

        if (isEmail(account) && accountData.email === account) {
            res.type = "email";
        }
        if (isMobilePhone(account, "zh-CN") && accountData.phone === account) {
            res.type = "mobile";
        }
        if (accountData.username === account) {
            res.type = "username";
        }
        res.hasAccount = true;
        res.hasPassword = !!accountData.password;

        return res;
    }

    /**
     * 验证令牌
     *
     * @param token JWT令牌
     * @returns 验证结果
     */
    async validateToken(token: string | undefined): Promise<{
        isValid: boolean;
        user: UserPlayground | undefined;
        tokenRecord?: UserToken;
        error?: string;
        errorType?: string;
        originalError?: any;
    }> {
        try {
            if (!token) {
                return {
                    isValid: false,
                    user: undefined,
                    error: "缺少访问令牌",
                };
            }
            // 使用令牌服务验证令牌
            const result = await this.userTokenService.validateToken(token);

            if (!result.isValid) {
                this.logger.warn(`令牌验证失败: ${result.error}`);
                return {
                    isValid: false,
                    user: undefined,
                    error: result.error,
                    errorType: "JsonWebTokenError",
                };
            }

            const payload = result.payload as LoginUserPlayground;

            // 从数据库验证用户是否仍然存在
            const user = await this.findOne({
                where: { id: payload.id },
            });

            if (!user) {
                return {
                    isValid: false,
                    user: undefined,
                    error: "无效的令牌",
                    errorType: "JsonWebTokenError",
                };
            }

            if (isDisabled(user.status)) {
                await this.userTokenService.revokeAllTokens(user.id);
                return {
                    isValid: false,
                    user: undefined,
                    error: "账号已被禁用，请联系客服",
                    errorType: "UserDisabledError",
                };
            }

            let updatedPayload: UserPlayground;

            const role = await this.rolePermissionService.getUserRoles(user.id);
            const permissions = await this.rolePermissionService.getUserPermissions(user.id);

            updatedPayload = {
                ...payload,
                role,
                permissions,
            };

            return {
                isValid: true,
                user: updatedPayload,
                tokenRecord: result.tokenRecord,
            };
        } catch (error) {
            return {
                isValid: false,
                user: undefined,
                error: error.message,
                errorType: error.name, // 保留原始异常类型
                originalError: error, // 保留完整的原始异常对象
            };
        }
    }

    /**
     * 用户注册
     *
     * @param registerDto 注册信息
     * @param terminal 注册终端
     * @param ipAddress IP地址
     * @param userAgent 用户代理
     * @returns 注册结果
     */
    async register(
        registerDto: RegisterDto,
        terminal: UserTerminalType = UserTerminal.PC,
        ipAddress?: string,
        userAgent?: string,
    ) {
        const { password, confirmPassword } = registerDto;
        if (password !== confirmPassword) {
            throw HttpErrorFactory.badRequest("两次密码不一致", BusinessCode.VALIDATION_FAILED);
        }

        // 检查用户名是否已存在
        const existingUser = await this.userRepository.findOne({
            where: { username: registerDto.username },
        });

        if (existingUser) {
            throw HttpErrorFactory.badRequest("用户名已被占用", BusinessCode.USER_ALREADY_EXISTS);
        }

        // 加密密码
        const salt = await bcrypt.genSalt();
        const hashedPassword = await bcrypt.hash(registerDto.password, salt);

        const { nickname: generatedNickname, avatar } = this.generateRandomName();
        const nickname = registerDto.nickname?.trim() || generatedNickname;
        const email = registerDto.email?.trim();
        const phone = registerDto.phone?.trim();
        const userNo = await generateNo(this.userRepository, "userNo");
        // 创建用户
        const savedUser = await this.create(
            {
                username: registerDto.username,
                password: hashedPassword,
                nickname,
                email: email || undefined,
                phone: phone || undefined,
                status: BooleanNumber.YES, // 默认启用
                source: UserCreateSource.USERNAME,
                avatar,
                userNo,
            },
            { excludeFields: ["password"] },
        );

        // 生成&验证令牌
        const payload = checkUserLoginPlayground({
            id: savedUser.id,
            username: savedUser.username,
            isRoot: BooleanNumber.NO,
            terminal: terminal,
        });

        // 创建并存储令牌
        const tokenResult = await this.userTokenService.createToken(
            savedUser.id,
            payload,
            terminal,
            ipAddress,
            userAgent,
        );
        // 返回登录结果
        return {
            token: tokenResult.token,
            expiresAt: tokenResult.expiresAt,
            user: {
                ...savedUser,
                permission: [],
                role: {},
            },
        };
    }

    /**
     * 用户登录
     *
     * @param username 用户名
     * @param password 密码
     * @param terminal 登录终端
     * @param ipAddress IP地址
     * @param userAgent 用户代理
     * @returns 登录结果
     */
    async login(
        username: string,
        password: string,
        terminal: UserTerminalType = UserTerminal.PC,
        ipAddress?: string,
        userAgent?: string,
    ) {
        // 查找用户
        let user = await this.findOne({
            where: { username },
            relations: ["role", "permissions"],
        });

        // 验证密码：优先走 AD 认证（若启用），否则用本地 bcrypt
        const adConfig = await this.adAuthService.getConfig();
        const isDomainUsername = /^[a-zA-Z0-9._-]{1,64}$/.test(username);

        if (adConfig.enabled && !user && isDomainUsername) {
            // 域账号首登自动建档（ADR-08）：本地无档案但 AD 验证通过 → 创建后继续登录流程
            const adInfo = await this.adAuthService.verifyWithAttributes(username, password);
            if (!adInfo) {
                throw HttpErrorFactory.unauthorized(
                    "Invalid email, account, phone number, or password.",
                    BusinessCode.LOGIN_FAILED,
                );
            }
            if (adInfo.disabled) {
                throw HttpErrorFactory.forbidden(
                    "The domain account has been disabled.",
                    BusinessCode.USER_DISABLED,
                );
            }
            user = await this.provisionFromAd(adInfo);
            // 建档后重新加载角色关系
            user = (await this.findOne({
                where: { username },
                relations: ["role", "permissions"],
            })) as User;
        }

        // 如果用户不存在
        if (!user) {
            throw HttpErrorFactory.unauthorized(
                "Invalid email, account, or phone number.",
                BusinessCode.LOGIN_FAILED,
            );
        }

        let isPasswordValid = false;

        if (adConfig.enabled) {
            if (!isDomainUsername) {
                // 邮箱/手机号登录不做 LDAP 绑定验证，保持本地密码逻辑
                isPasswordValid = await bcrypt.compare(password, user.password);
                if (!isPasswordValid) {
                    throw HttpErrorFactory.unauthorized(
                        "Invalid email, account, phone number, or password.",
                        BusinessCode.LOGIN_FAILED,
                    );
                }
            } else {
                // 域账号登录：绑定验证 + 属性顺手同步（姓名/邮箱/部门/禁用状态），幂等且开销极低
                const adInfo = await this.adAuthService.verifyWithAttributes(username, password);
                if (!adInfo) {
                    throw HttpErrorFactory.unauthorized(
                        "Invalid email, account, phone number, or password.",
                        BusinessCode.LOGIN_FAILED,
                    );
                }
                isPasswordValid = true;
                await this.applyAdUser(user, adInfo);
            }
            // 复核禁用状态（applyAdUser 可能已把域禁用落到本地档案）
            if (isDomainUsername || isDisabled(user.status)) {
                const fresh = await this.findOne({ where: { username } });
                if (fresh && isDisabled(fresh.status)) {
                    throw HttpErrorFactory.forbidden(
                        "The account has been disabled.",
                        BusinessCode.USER_DISABLED,
                    );
                }
            }
        } else {
            // 本地密码验证
            isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                throw HttpErrorFactory.unauthorized(
                    "Invalid email, account, phone number, or password.",
                    BusinessCode.LOGIN_FAILED,
                );
            }
        }

        // 检查用户状态
        if (isDisabled(user.status)) {
            throw HttpErrorFactory.forbidden(
                "The account has been disabled.",
                BusinessCode.USER_DISABLED,
            );
        }

        // 获取用户角色和权限信息
        const role = await this.rolePermissionService.getUserRoles(user.id);
        const permissions = await this.rolePermissionService.getUserPermissions(user.id);

        // 生成&验证令牌
        const payload = checkUserLoginPlayground({
            id: user.id,
            username: user.username,
            isRoot: user.isRoot,
            terminal: terminal,
        });

        // 创建并存储令牌
        const tokenResult = await this.userTokenService.createToken(
            user.id,
            payload,
            terminal,
            ipAddress,
            userAgent,
        );

        // 更新用户最后登录时间
        await this.updateById(user.id, {
            lastLoginAt: new Date(),
        });

        const { password: _pwd, ...userInfo } = user;

        return {
            token: tokenResult.token,
            expiresAt: tokenResult.expiresAt,
            user: {
                ...userInfo,
                role,
                permissions,
            },
        };
    }

    /**
     * 通过 openid 查找用户，如果没有绑定则自动注册，有则直接登录
     *
     * @param openid 微信 openid
     * @param terminal 登录终端
     * @param ipAddress IP地址
     * @param userAgent 用户代理
     * @returns 登录结果
     */
    async loginOrRegisterByOpenid(
        openid: string,
        terminal: UserTerminalType = UserTerminal.PC,
        ipAddress?: string,
        userAgent?: string,
    ) {
        // 查找是否已有用户绑定此 openid
        const existingUser = await this.findOne({
            where: { openid },
        });

        if (existingUser) {
            // 用户已存在，直接登录
            return this.loginByUser(existingUser, terminal, ipAddress, userAgent);
        } else {
            // 用户不存在，自动注册
            return this.registerByOpenid(openid, terminal, ipAddress, userAgent);
        }
    }

    /**
     * 通过 openid 自动注册用户
     *
     * @param openid 微信 openid
     * @param terminal 注册终端
     * @param ipAddress IP地址
     * @param userAgent 用户代理
     * @returns 注册结果
     */
    private async registerByOpenid(
        openid: string,
        terminal: UserTerminalType = UserTerminal.PC,
        ipAddress?: string,
        userAgent?: string,
    ) {
        const { nickname, username, avatar } = this.generateRandomName();
        const userNo = await generateNo(this.userRepository, "userNo");

        // 创建用户
        const savedUser = await this.create(
            {
                openid,
                username,
                nickname,
                password: "",
                status: BooleanNumber.YES, // 默认启用
                source: UserCreateSource.WECHAT, // 标记为微信注册
                avatar,
                userNo,
            },
            { excludeFields: ["password", "openid"] },
        );
        // 重新获取完整的用户信息以确保类型正确
        const fullUser = await this.findOne({
            where: { id: savedUser.id },
        });

        if (!fullUser) {
            throw HttpErrorFactory.badRequest("用户创建失败");
        }

        // 生成&验证令牌
        const payload = checkUserLoginPlayground({
            id: fullUser.id,
            username: fullUser.username,
            isRoot: BooleanNumber.NO,
            terminal: terminal,
        });

        // 创建并存储令牌
        const tokenResult = await this.userTokenService.createToken(
            fullUser.id,
            payload,
            terminal,
            ipAddress,
            userAgent,
        );

        // 返回登录结果
        return {
            expiresAt: tokenResult.expiresAt,
            token: tokenResult.token,
            user: {
                ...fullUser,
                permission: [],
                role: {},
            },
        };
    }

    /**
     * 通过用户对象直接登录
     *
     * @param user 用户对象
     * @param terminal 登录终端
     * @param ipAddress IP地址
     * @param userAgent 用户代理
     * @returns 登录结果
     */
    async loginByUser(
        user: User,
        terminal: UserTerminalType = UserTerminal.PC,
        ipAddress?: string,
        userAgent?: string,
    ) {
        // 检查用户状态
        if (isDisabled(user.status)) {
            throw HttpErrorFactory.forbidden(
                "账号已被禁用，请联系客服",
                BusinessCode.USER_DISABLED,
            );
        }

        // 获取用户角色和权限信息
        const role = await this.rolePermissionService.getUserRoles(user.id);
        const permissions = await this.rolePermissionService.getUserPermissions(user.id);

        // 生成&验证令牌
        const payload = checkUserLoginPlayground({
            id: user.id,
            username: user.username,
            isRoot: user.isRoot,
            terminal: terminal,
        });

        // 创建并存储令牌
        const tokenResult = await this.userTokenService.createToken(
            user.id,
            payload,
            terminal,
            ipAddress,
            userAgent,
        );

        await this.updateById(user.id, {
            lastLoginAt: new Date(),
        });

        const { password: _pwd, openid: _openid, ...userInfo } = user;

        return {
            expiresAt: tokenResult.expiresAt,
            token: tokenResult.token,
            user: {
                ...userInfo,
                role,
                permissions,
            },
        };
    }

    /**
     * 修改用户密码
     *
     * @param userId 用户ID
     * @param oldPassword 旧密码
     * @param newPassword 新密码
     * @param confirmPassword 确认密码
     * @returns 修改结果
     */
    async changePassword(
        userId: string,
        oldPassword: string,
        newPassword: string,
        confirmPassword: string,
    ) {
        // 验证新密码与确认密码是否一致
        if (newPassword !== confirmPassword) {
            throw HttpErrorFactory.badRequest(
                "新密码与确认密码不一致",
                BusinessCode.VALIDATION_FAILED,
            );
        }

        // 查找用户，只需要基本信息和密码字段
        const user = await this.findOne({
            where: { id: userId },
        });

        if (!user) {
            throw HttpErrorFactory.notFound(`ID为 ${userId} 的用户不存在`);
        }

        // 验证旧密码
        const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
        if (!isOldPasswordValid) {
            throw HttpErrorFactory.badRequest("旧密码不正确", BusinessCode.PASSWORD_INCORRECT);
        }

        // 生成新密码的哈希
        const salt = await bcrypt.genSalt();
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // 更新密码
        await this.updateById(userId, {
            password: hashedPassword,
        });

        // 清除用户所有 token，强制重新登录
        await this.userTokenService.revokeAllTokens(userId);

        return null;
    }

    /**
     * 设置用户密码
     *
     * 适用于通过手机号/微信/谷歌等第三方方式登录后，首次设置登录密码。
     * 该场景不需要验证旧密码。
     *
     * @param userId 用户ID
     * @param newPassword 新密码
     * @param confirmPassword 确认密码
     * @returns 设置结果
     */
    async setPassword(userId: string, newPassword: string, confirmPassword: string) {
        // 验证新密码与确认密码是否一致
        if (newPassword !== confirmPassword) {
            throw HttpErrorFactory.badRequest(
                "新密码与确认密码不一致",
                BusinessCode.VALIDATION_FAILED,
            );
        }

        // 查找用户
        const user = await this.findOne({
            where: { id: userId },
        });

        if (!user) {
            throw HttpErrorFactory.notFound(`ID为 ${userId} 的用户不存在`);
        }

        // 已设置过密码的用户不允许通过 set-password 覆盖，应使用 change-password
        if (user.password) {
            throw HttpErrorFactory.badRequest("用户已设置密码，请使用修改密码功能");
        }

        // 生成新密码的哈希
        const salt = await bcrypt.genSalt();
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // 更新密码
        await this.updateById(userId, {
            password: hashedPassword,
        });

        return null;
    }

    /**
     * 退出登录
     *
     * 在撤销令牌后，清理该用户的角色与权限缓存：
     * - user_roles:${userId}
     * - user_permissions:${userId}
     *
     * @param token JWT令牌
     * @returns 退出结果
     */
    async logout(token: string): Promise<{ success: boolean; message: string }> {
        try {
            // 先查找令牌记录以获取 userId（即使令牌已过期，记录仍可能存在）
            const tokenRecord = await this.userTokenService.findOne({
                where: { token },
            });
            const userId = tokenRecord?.userId;

            const result = await this.userTokenService.revokeToken(token);

            console.log("result", result);

            if (result) {
                // 撤销成功后清理该用户的权限相关缓存（忽略清理失败，不影响主流程）
                if (userId) {
                    this.rolePermissionService
                        .clearUserCache(userId)
                        .catch((e) => this.logger.warn(`清理用户缓存失败: ${e.message}`));
                }

                return {
                    success: true,
                    message: "退出登录成功",
                };
            } else {
                return {
                    success: false,
                    message: "令牌不存在或已失效",
                };
            }
        } catch (error) {
            this.logger.error(`退出登录失败: ${error.message}`);
            throw HttpErrorFactory.internal("退出登录失败", BusinessCode.OPERATION_FAILED);
        }
    }

    async loginBySms(
        phone: string,
        phoneAreaCode: string,
        terminal: UserTerminalType = UserTerminal.PC,
        ipAddress?: string,
        userAgent?: string,
    ) {
        const user = await this.findOne({ where: { phone, phoneAreaCode } });

        if (!user) {
            return this.registerByPhone(phone, phoneAreaCode, terminal, ipAddress, userAgent);
        }

        return this.loginByUser(user, terminal, ipAddress, userAgent);
    }

    private async registerByPhone(
        phone: string,
        phoneAreaCode: string,
        terminal: UserTerminalType = UserTerminal.PC,
        ipAddress?: string,
        userAgent?: string,
    ) {
        const { username, nickname, avatar } = this.generateRandomName();
        const userNo = await generateNo(this.userRepository, "userNo");

        // Create user
        const savedUser = await this.create(
            {
                phone,
                phoneAreaCode,
                username,
                nickname,
                avatar,
                userNo,
                password: "",
                status: BooleanNumber.YES,
                source: UserCreateSource.PHONE,
            },
            { excludeFields: ["password"] },
        );

        // Create token
        const payload = checkUserLoginPlayground({
            id: savedUser.id,
            username: savedUser.username,
            isRoot: BooleanNumber.NO,
            terminal,
        });

        const tokenResult = await this.userTokenService.createToken(
            savedUser.id,
            payload,
            terminal,
            ipAddress,
            userAgent,
        );

        return {
            token: tokenResult.token,
            expiresAt: tokenResult.expiresAt,
            user: {
                ...savedUser,
                permission: [],
                role: {},
            },
        };
    }

    private generateRandomName() {
        const randomSuffix = Math.random().toString(34).substring(2, 8);
        const randomUsername = `${randomSuffix}`;

        const randomIndex = Math.floor(Math.random() * nicknameData.length);
        const randomNickname = nicknameData[randomIndex];

        const randomAvatarIndex = Math.floor(Math.random() * 33) + 1;
        const randomAvatar = `/static/avatars/${randomAvatarIndex}.png`;

        return {
            username: randomUsername,
            nickname: randomNickname,
            avatar: randomAvatar,
        };
    }

    /**
     * 通过 openid 自动注册用户
     *
     * @param openid 微信 openid
     * @param terminal 注册终端
     * @param ipAddress IP地址
     * @param userAgent 用户代理
     * @returns 注册结果
     */
    async registerByWechat(
        Conditions: { openid: string } | { mpOpenid: string },
        terminal: UserTerminalType = UserTerminal.PC,
        ipAddress?: string,
        userAgent?: string,
    ) {
        // 生成随机用户名（随机字符串）
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const username = `${randomSuffix}`;

        // 生成随机昵称
        const randomIndex = Math.floor(Math.random() * nicknameData.length);
        const randomAvatarIndex = Math.floor(Math.random() * 36) + 1;
        const randomNickname = nicknameData[randomIndex];
        const userNo = await generateNo(this.userRepository, "userNo");

        // 创建用户
        const savedUser = await this.create(
            {
                ...Conditions,
                username,
                password: "",
                nickname: randomNickname,
                status: BooleanNumber.YES, // 默认启用
                source: UserCreateSource.WECHAT, // 标记为微信注册
                avatar: `/static/avatars/${randomAvatarIndex}.png`,
                userNo,
            },
            { excludeFields: ["password", "openid"] },
        );
        // 重新获取完整的用户信息以确保类型正确
        const fullUser = await this.findOne({
            where: { id: savedUser.id },
        });

        if (!fullUser) {
            throw HttpErrorFactory.badRequest("用户创建失败");
        }
        // 生成&验证令牌
        const payload = checkUserLoginPlayground({
            id: fullUser.id,
            username: fullUser.username,
            isRoot: BooleanNumber.NO,
            terminal: terminal,
        });

        // 创建并存储令牌
        const tokenResult = await this.userTokenService.createToken(
            fullUser.id,
            payload,
            terminal,
            ipAddress,
            userAgent,
        );

        // 返回登录结果
        return {
            expiresAt: tokenResult.expiresAt,
            user: {
                token: tokenResult.token,
                ...fullUser,
                permission: [],
                role: {},
            },
        };
    }

    // ── AD 域账号：首登建档与同步（ADR-08）──────────────────────────────

    /**
     * 域账号首登自动建档
     *
     * 语义与员工 Excel 导入保持一致（来源 CONSOLE、随机占位密码、默认头像），
     * 占位密码不可用于本地登录——AD 启用期间登录一律走 LDAP 绑定验证。
     */
    private async provisionFromAd(info: AdUserInfo): Promise<User> {
        const placeholderPassword = `ad-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const created = await this.userRepository.save(
            this.userRepository.create({
                username: info.username,
                password: await bcrypt.hash(placeholderPassword, 10),
                email: info.email || undefined,
                realName: info.displayName || undefined,
                nickname: info.displayName || info.username,
                status: info.disabled ? 0 : 1,
                source: UserCreateSource.CONSOLE,
                userNo: await generateNo(this.userRepository, "userNo"),
                avatar: `/static/avatars/${Math.floor(Math.random() * 33) + 1}.png`,
            }),
        );
        if (created && info.ouNames.length > 0) {
            const deptIds = await this.ensureDepartmentsFromOu(info.ouNames);
            for (const departmentId of deptIds) {
                await this.departmentUserIndexRepository.save(
                    this.departmentUserIndexRepository.create({ userId: created.id, departmentId }),
                );
            }
        }
        return created;
    }

    /**
     * 单个域用户属性落库（登录顺手同步 + 定时批量同步共用）
     *
     * 同步项：realName/email/昵称、部门归属（OU 变更迁移）、禁用状态联动撤票。
     */
    private async applyAdUser(existing: User, info: AdUserInfo): Promise<void> {
        const updates: Partial<User> = {};

        if (!existing.realName && info.displayName && existing.realName !== info.displayName) {
            updates.realName = info.displayName;
        }
        if (!existing.nickname && (info.displayName || info.username)) {
            updates.nickname = info.displayName ?? info.username;
        }
        if (info.email && existing.email !== info.email) {
            updates.email = info.email;
        }
        if (info.disabled && !isDisabled(existing.status)) {
            updates.status = 0;
        } else if (!info.disabled && isDisabled(existing.status) && existing.password.startsWith("$2")) {
            // 域恢复启用；占位密码账号在 AD 恢复时同步解禁
            updates.status = 1;
        }

        if (Object.keys(updates).length > 0) {
            await this.updateById(existing.id, updates);
        }

        // 部门归属同步：OU 决定部门，变更则整体重建关联（个人手工调整会被覆盖，
        // 以目录为准是该类企业的预期行为）
        if (info.ouNames.length > 0) {
            const deptIds = await this.ensureDepartmentsFromOu(info.ouNames);
            const current = await this.departmentUserIndexRepository.find({
                where: { userId: existing.id },
            });
            const currentSet = new Set(current.map((c) => c.departmentId));
            const targetSet = new Set(deptIds);
            const changed =
                currentSet.size !== targetSet.size ||
                [...targetSet].some((id) => !currentSet.has(id));
            if (changed) {
                await this.departmentUserIndexRepository.delete({ userId: existing.id });
                for (const departmentId of targetSet) {
                    await this.departmentUserIndexRepository.save(
                        this.departmentUserIndexRepository.create({
                            userId: existing.id,
                            departmentId,
                        }),
                    );
                }
            }
        }

        // 域侧被禁用且此前活跃 → 立即撤销全部会话（ADR-08 缺口三）
        if (updates.status === 0) {
            await this.userTokenService.revokeAllTokens(existing.id);
        }
    }

    /**
     * 批量应用域用户清单（定时/手动触发同步的入口）
     *
     * 行为：
     * - 本地已存在 → 属性/部门/状态同步
     * - 本地不存在且未禁用 → 自动建档（首登建档同一套规则）
     * - 域内消失的活跃 CONSOLE 账号不动（可能来自 Excel 导入而非域）
     */
    async applyAdUsers(list: AdUserInfo[]): Promise<{ provisioned: number; updated: number; disabled: number }> {
        const result = { provisioned: 0, updated: 0, disabled: 0 };
        for (const info of list) {
            try {
                const existing = await this.findOne({ where: { username: info.username } });
                if (!existing) {
                    if (info.disabled) continue; // 已禁用的陌生域账号不建档
                    await this.provisionFromAd(info);
                    result.provisioned += 1;
                    continue;
                }
                const wasActive = !isDisabled(existing.status);
                await this.applyAdUser(existing as User, info);
                if (info.disabled && wasActive) result.disabled += 1;
                else result.updated += 1;
            } catch (err) {
                // 单个用户失败不阻断整批
                continue;
            }
        }
        return result;
    }

    /**
     * 按 OU 链确保部门存在并返回部门 id 列表（对齐员工导入的建部门规则）
     *
     * ouNames 自内向外，如 ["研发组", "技术中心"] →
     * 一级部门「技术中心」+ 二级部门「研发组」（挂同名一级下）；
     * 只有一个 OU 时视为一级部门。
     */
    private async ensureDepartmentsFromOu(ouNames: string[]): Promise<string[]> {
        // 一级部门名 / 二级部门名（挂在某一级名下）
        let l1Name: string | null = null;
        let l2Name: string | null = null;
        if (ouNames.length >= 2) {
            l1Name = ouNames[1]!;
            l2Name = ouNames[0]!;
        } else if (ouNames.length === 1) {
            l1Name = ouNames[0]!;
        }
        if (!l1Name) return [];

        const ids: string[] = [];
        const all = await this.departmentRepository.find();
        const byKey = new Map(all.map((d) => [`${d.level}:${d.name}`, d]));

        let l1 = byKey.get(`1:${l1Name}`);
        if (!l1) {
            const rootDept = all.find((d) => d.level === 1 && d.system === 1) ?? null;
            l1 = await this.departmentRepository.save(
                this.departmentRepository.create({
                    name: l1Name,
                    parentId: rootDept ? rootDept.id : null,
                    level: 1,
                    system: 0,
                }),
            );
        }
        ids.push(l1.id);

        if (l2Name) {
            let l2 = all.find((d) => d.level === 2 && d.name === l2Name && d.parentId === l1.id);
            if (!l2) {
                l2 = await this.departmentRepository.save(
                    this.departmentRepository.create({
                        name: l2Name,
                        parentId: l1.id,
                        level: 2,
                        system: 0,
                    }),
                );
            }
            ids.push(l2.id);
        }
        return ids;
    }
}
