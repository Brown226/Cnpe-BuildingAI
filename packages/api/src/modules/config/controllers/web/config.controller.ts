import { BaseController } from "@buildingai/base";
import { LOGIN_TYPE } from "@buildingai/constants";
import { BuildFileUrl } from "@buildingai/decorators/file-url.decorator";
import { Public } from "@buildingai/decorators/public.decorator";
import { DictService } from "@buildingai/dict";
import { WebController } from "@common/decorators/controller.decorator";
import { ChatConfigService } from "@modules/ai/chat/services/chat-config.service";
import { DatasetsConfigService } from "@modules/config/services/datasets-config.service";
import { WebsiteService } from "@modules/system/services/website.service";
import { Get } from "@nestjs/common";

@WebController("config")
export class ConfigWebController extends BaseController {
    constructor(
        private readonly websiteService: WebsiteService,
        private readonly chatConfigService: ChatConfigService,
        private readonly datasetsConfigService: DatasetsConfigService,
        private readonly dictService: DictService,
    ) {
        super();
    }

    @Get()
    @BuildFileUrl(["**.logo", "**.icon", "***.iconUrl", "***.copyrightUrl"])
    @Public()
    async getConfig() {
        const websiteConfig = await this.websiteService.getConfig();
        const [loginSettings, membershipEnabled, cdkEnabled, cdkNotice, rechargeEnabled] =
            await Promise.all([
                this.dictService.get("login_settings", this.getDefaultLoginSettings(), "auth"),
                this.dictService.get("membership_plans_status", false, "membership_config"),
                this.dictService.get("card_key_enabled", false, "card_key"),
                this.dictService.get("card_key_notice", "", "card_key"),
                this.dictService.get("recharge_status", false, "recharge_config"),
            ]);

        return {
            ...websiteConfig,
            loginSettings,
            features: {
                membership: Boolean(membershipEnabled),
                cdk: Boolean(cdkEnabled),
                recharge: Boolean(rechargeEnabled),
            },
            cdk: {
                notice: cdkNotice || "",
            },
        };
    }

    private getDefaultLoginSettings() {
        return {
            allowedLoginMethods: [LOGIN_TYPE.ACCOUNT, LOGIN_TYPE.WECHAT],
            allowedRegisterMethods: [LOGIN_TYPE.ACCOUNT, LOGIN_TYPE.WECHAT],
            allowMultipleLogin: true,
            showPolicyAgreement: true,
        };
    }

    @Get("agreement")
    @Public()
    async getAgreement() {
        const fullConfig = await this.websiteService.getConfig();

        return {
            agreement: fullConfig.agreement,
        };
    }

    @Get("chat")
    @Public()
    async getChatConfig() {
        return await this.chatConfigService.getChatConfig();
    }

    @Get("datasets")
    @Public()
    async getDatasetsConfig() {
        const config = await this.datasetsConfigService.getConfig();
        return {
            squarePublishSkipReview: config.squarePublishSkipReview,
        };
    }
}
