import { BaseService } from "@buildingai/base";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { Dict } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { DictService } from "@buildingai/dict";
import { Injectable } from "@nestjs/common";

import { UpdateChatConfigDto } from "../dto/ai-chat-config.dto";

/**
 * 对话配置服务
 * 管理聊天页面的建议选项、欢迎信息等配置
 */
@Injectable()
export class ChatConfigService extends BaseService<Dict> {
    constructor(
        private readonly dictService: DictService,
        @InjectRepository(Dict) repository: Repository<Dict>,
    ) {
        super(repository);
    }

    /**
     * 获取对话配置
     * @returns 对话配置信息
     */
    async getChatConfig() {
        // 获取建议选项配置
        const suggestions = await this.dictService.get(
            "chat_suggestions",
            [
                { icon: "🎮", text: "写一个像宝可梦方式的小游戏" },
                { icon: "📅", text: "2025年节日安排出来了吗?" },
                { icon: "😊", text: "AI时代，什么能力不可被替代?" },
                { icon: "📝", text: "一篇生成爆款小红书笔记" },
                { icon: "🔍", text: "AI能成为全球人类产生威胁吗?" },
            ],
            "chat_config",
        );

        // 获取建议选项启用状态
        const suggestionsEnabled = await this.dictService.get(
            "chat_suggestions_enabled",
            false,
            "chat_config",
        );

        // 获取欢迎信息配置
        const welcomeInfo = await this.dictService.get(
            "chat_welcome",
            {
                title: "👋 你好，我可以帮你做什么？",
                description: "作为你的智能伙伴，写文案、写代码、理思路、整理文档等，都可以交给我",
                footer: "内容由AI生成，无法确保真实准确，仅供参考。",
            },
            "chat_config",
        );

        const attachmentSizeLimit = await this.dictService.get(
            "chat_attachment_size_limit",
            10,
            "chat_config",
        );

        const showMcpToolDetails = await this.dictService.get(
            "chat_show_mcp_tool_details",
            true,
            "chat_config",
        );

        const memoryModelId = await this.dictService.get<string | null>(
            "chat_memory_model_id",
            null,
            "chat_config",
        );

        const titleModelId = await this.dictService.get<string | null>(
            "chat_title_model_id",
            null,
            "chat_config",
        );

        const followUpModelId = await this.dictService.get<string | null>(
            "chat_follow_up_model_id",
            null,
            "chat_config",
        );

        return {
            suggestions,
            suggestionsEnabled,
            welcomeInfo,
            attachmentSizeLimit,
            showMcpToolDetails,
            memoryModelId: memoryModelId ?? undefined,
            titleModelId: titleModelId ?? undefined,
            followUpModelId: followUpModelId ?? undefined,
        };
    }

    /**
     * 设置对话配置
     * @param updateChatConfigDto 更新对话配置DTO
     * @returns 更新结果
     */
    async setChatConfig(updateChatConfigDto: UpdateChatConfigDto) {
        const {
            suggestions,
            suggestionsEnabled,
            welcomeInfo,
            attachmentSizeLimit,
            showMcpToolDetails,
            memoryModelId,
            titleModelId,
            followUpModelId,
        } = updateChatConfigDto;

        try {
            // 更新建议选项配置
            if (suggestions !== undefined) {
                await this.dictService.set("chat_suggestions", suggestions, {
                    group: "chat_config",
                    description: "聊天建议选项配置",
                });
            }

            // 更新建议选项启用状态
            if (suggestionsEnabled !== undefined) {
                await this.dictService.set("chat_suggestions_enabled", suggestionsEnabled, {
                    group: "chat_config",
                    description: "聊天建议选项启用状态",
                });
            }

            // 更新欢迎信息配置
            if (welcomeInfo !== undefined) {
                await this.dictService.set("chat_welcome", welcomeInfo, {
                    group: "chat_config",
                    description: "聊天欢迎信息配置",
                });
            }

            // 更新附件大小限制配置
            if (attachmentSizeLimit !== undefined) {
                await this.dictService.set("chat_attachment_size_limit", attachmentSizeLimit, {
                    group: "chat_config",
                    description: "聊天附件大小限制配置",
                });
            }

            if (showMcpToolDetails !== undefined) {
                await this.dictService.set("chat_show_mcp_tool_details", showMcpToolDetails, {
                    group: "chat_config",
                    description: "MCP 工具调用详情显示状态",
                });
            }

            if (memoryModelId !== undefined) {
                await this.dictService.set("chat_memory_model_id", memoryModelId || null, {
                    group: "chat_config",
                    description: "记忆提取模型ID",
                });
            }

            if (titleModelId !== undefined) {
                await this.dictService.set("chat_title_model_id", titleModelId || null, {
                    group: "chat_config",
                    description: "标题生成模型ID",
                });
            }

            if (followUpModelId !== undefined) {
                await this.dictService.set("chat_follow_up_model_id", followUpModelId || null, {
                    group: "chat_config",
                    description: "对话追问建议模型ID",
                });
            }

            return { success: true, message: "对话配置更新成功" };
        } catch (error) {
            this.logger.error(`更新对话配置失败: ${error.message}`);
            throw error;
        }
    }
}
