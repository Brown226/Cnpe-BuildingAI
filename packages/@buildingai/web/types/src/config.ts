export interface LoginSettingsConfig {
    allowedLoginMethods: number[];
    allowedRegisterMethods: number[];
    allowMultipleLogin: boolean;
    showPolicyAgreement: boolean;
}

export interface WebsiteConfig {
    webinfo: {
        name: string;
        description: string;
        icon: string;
        logo: string;
        /** 客服二维码图片地址 */
        customerServiceQrcode?: string;
        version: string;
        isDemo: boolean;
        theme?: string;
    };
    agreement: {
        serviceTitle: string;
        serviceContent: string;
        privacyTitle: string;
        privacyContent: string;
        paymentTitle: string;
        paymentContent: string;
        updateAt: string;
    };
    copyright: {
        displayName: string;
        iconUrl: string;
        url: string;
        copyrightText: string;
        copyrightBrand: string;
        copyrightUrl: string;
    };
    statistics: {
        appid: string;
    };
    loginSettings?: LoginSettingsConfig;
    features?: {
        membership: boolean;
        cdk: boolean;
        /** 充值功能开关：false 时隐藏用户端钱包/充值入口（企业免费模式） */
        recharge: boolean;
    };
    cdk?: {
        notice: string;
    };
}

export interface InitializeStatus {
    isInitialized: boolean;
    version: string;
}
