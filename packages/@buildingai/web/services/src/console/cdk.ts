import type {
    MutationOptionsUtil,
    PaginatedQueryOptionsUtil,
    PaginatedResponse,
    QueryOptionsUtil,
} from "@buildingai/web-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { consoleHttpClient } from "../base";

/**
 * 卡密兑换类型
 */
export const CardRedeemType = {
    /** 订阅会员 */
    MEMBERSHIP: 1,
    /** 积分余额 */
    POINTS: 2,
} as const;

export type CardRedeemType = (typeof CardRedeemType)[keyof typeof CardRedeemType];

/**
 * 卡密使用状态
 */
export const CardKeyStatus = {
    /** 未使用 */
    UNUSED: 0,
    /** 已使用 */
    USED: 1,
    /** 已过期 */
    EXPIRED: 2,
} as const;

export type CardKeyStatus = (typeof CardKeyStatus)[keyof typeof CardKeyStatus];

/**
 * 会员时长配置
 */
export const MembershipPlanDuration = {
    MONTH: 1,
    QUARTER: 2,
    HALF: 3,
    YEAR: 4,
    FOREVER: 5,
    CUSTOM: 6,
} as const;

export type MembershipPlanDuration = (typeof MembershipPlanDuration)[keyof typeof MembershipPlanDuration];

/**
 * 自定义时长
 */
export type Duration = {
    value: number;
    unit: string;
};

/**
 * 卡密批次列表项
 */
export type CardBatchListItem = {
    id: string;
    batchNo: string;
    name: string;
    redeemType: CardRedeemType;
    levelId: string | null;
    remark?: string;
    level?: {
        name: string;
        level: number;
        description: string | null;
    };
    expireAt: string;
    totalCount: number;
    usedCount: number;
    redeemContent: string;
    createdAt: string;
    updatedAt: string;
};

/**
 * 卡密列表项
 */
export type CardKeyListItem = {
    id: string;
    keyCode: string;
    batchId: string;
    batch?: {
        batchNo: string;
        name: string;
    };
    status: CardKeyStatus;
    userId: string | null;
    user?: {
        id: string;
        username: string;
        nickname: string | null;
        avatar: string | null;
    };
    usedAt: string | null;
    createdAt: string;
    redeemContent: string;
};

/**
 * 批次详情扩展信息
 */
export type BatchDetailExtends = {
    batchNo: string;
    name: string;
    redeemType: CardRedeemType;
    redeemContent: string;
    levelId: string | null;
    levelName: string | null;
    expireAt: string;
    totalCount: number;
    usedCount: number;
    remainingCount: number;
};

/**
 * 批次卡密列表响应
 */
export type BatchCardKeysResponse = PaginatedResponse<CardKeyListItem> & {
    extends: BatchDetailExtends;
};

/**
 * 卡密设置
 */
export type CDKSettings = {
    enabled: boolean;
    notice: string;
};

/**
 * 查询批次DTO
 */
export type QueryCardBatchDto = {
    page?: number;
    pageSize?: number;
    batchNo?: string;
    name?: string;
    redeemType?: CardRedeemType;
    startTime?: string;
    endTime?: string;
};

/**
 * 查询卡密DTO
 */
export type QueryCardKeyDto = {
    page?: number;
    pageSize?: number;
    batchId?: string;
    keyCode?: string;
    status?: CardKeyStatus;
    userId?: string;
    startTime?: string;
    endTime?: string;
};

/**
 * 创建批次DTO
 */
export type CreateCardBatchDto = {
    name: string;
    redeemType: CardRedeemType;
    levelId?: string;
    membershipDuration?: MembershipPlanDuration;
    customDuration?: Duration;
    pointsAmount?: number;
    expireAt: string;
    totalCount: number;
    remark?: string;
};

/**
 * 更新设置DTO
 */
export type UpdateCardSettingDto = {
    enabled?: boolean;
    notice?: string;
};

export type CardBatchListResponse = PaginatedResponse<CardBatchListItem>;
export type CardKeyListResponse = PaginatedResponse<CardKeyListItem>;

/**
 * 获取批次列表
 */
export function useCardBatchListQuery(
    params?: QueryCardBatchDto,
    options?: PaginatedQueryOptionsUtil<CardBatchListItem>,
) {
    return useQuery<CardBatchListResponse>({
        queryKey: ["card-batch", "list", params],
        queryFn: () => consoleHttpClient.get<CardBatchListResponse>("/card-batch", { params }),
        ...options,
    });
}

/**
 * 创建卡密批次
 */
export function useCreateCardBatchMutation(
    options?: MutationOptionsUtil<CardBatchListItem, CreateCardBatchDto>,
) {
    const queryClient = useQueryClient();
    return useMutation<CardBatchListItem, Error, CreateCardBatchDto>({
        mutationFn: (body) => consoleHttpClient.post<CardBatchListItem>("/card-batch", body),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["card-batch"] });
        },
        ...options,
    });
}

/**
 * 获取批次下的卡密列表
 */
export function useBatchCardKeysQuery(
    batchId: string,
    params?: QueryCardKeyDto,
    options?: QueryOptionsUtil<BatchCardKeysResponse>,
) {
    return useQuery<BatchCardKeysResponse>({
        queryKey: ["card-batch", batchId, "card-keys", params],
        queryFn: () =>
            consoleHttpClient.get<BatchCardKeysResponse>(`/card-batch/${batchId}`, { params }),
        enabled: !!batchId,
        ...options,
    });
}

/**
 * 删除批次
 */
export function useDeleteCardBatchMutation(options?: MutationOptionsUtil<void, { id: string }>) {
    const queryClient = useQueryClient();
    return useMutation<void, Error, { id: string }>({
        mutationFn: ({ id }) => consoleHttpClient.delete<void>(`/card-batch/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["card-batch"] });
        },
        ...options,
    });
}

/**
 * 获取卡密列表
 */
export function useCardKeyListQuery(
    params?: QueryCardKeyDto,
    options?: PaginatedQueryOptionsUtil<CardKeyListItem>,
) {
    return useQuery<CardKeyListResponse>({
        queryKey: ["card-key", "list", params],
        queryFn: () => consoleHttpClient.get<CardKeyListResponse>("/card-key", { params }),
        ...options,
    });
}

/**
 * 获取已使用的卡密列表
 */
export function useUsedCardKeyListQuery(
    params?: QueryCardKeyDto,
    options?: PaginatedQueryOptionsUtil<CardKeyListItem>,
) {
    return useQuery<CardKeyListResponse>({
        queryKey: ["card-key", "used", params],
        queryFn: () => consoleHttpClient.get<CardKeyListResponse>("/card-key/used", { params }),
        ...options,
    });
}

/**
 * 获取卡密设置
 */
export function useCDKSettingsQuery(options?: QueryOptionsUtil<CDKSettings>) {
    return useQuery<CDKSettings>({
        queryKey: ["card-key", "settings"],
        queryFn: () => consoleHttpClient.get<CDKSettings>("/card-setting"),
        ...options,
    });
}

/**
 * 更新卡密设置
 */
export function useUpdateCDKSettingsMutation(
    options?: MutationOptionsUtil<CDKSettings, UpdateCardSettingDto>,
) {
    const queryClient = useQueryClient();
    return useMutation<CDKSettings, Error, UpdateCardSettingDto>({
        mutationFn: (body) => consoleHttpClient.patch<CDKSettings>("/card-setting", body),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["card-key", "settings"] });
        },
        ...options,
    });
}
