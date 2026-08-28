import type {
    MutationOptionsUtil,
    PaginatedQueryOptionsUtil,
    QueryOptionsUtil,
} from "@buildingai/web-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { consoleHttpClient } from "../base";

// Enums
export const MenuType = {
    GROUP: 0,
    DIRECTORY: 1,
    MENU: 2,
    BUTTON: 3,
} as const;

export type MenuType = (typeof MenuType)[keyof typeof MenuType];

export const MenuSourceType = {
    SYSTEM: 1,
    PLUGIN: 2,
} as const;

export type MenuSourceType = (typeof MenuSourceType)[keyof typeof MenuSourceType];

// Types
export type Menu = {
    id: string;
    name: string;
    code?: string;
    path?: string;
    icon?: string;
    component?: string;
    permissionCode?: string;
    parentId?: string;
    sort: number;
    isHidden: number;
    type: MenuType;
    sourceType: MenuSourceType;
    children?: Menu[];
    createdAt: string;
    updatedAt: string;
};

export type QueryMenuParams = {
    page?: number;
    pageSize?: number;
    name?: string;
    type?: MenuType;
    parentId?: string;
    sourceType?: MenuSourceType;
};

export type CreateMenuParams = {
    name: string;
    path?: string;
    code?: string;
    icon?: string;
    component?: string;
    permissionCode?: string;
    parentId?: string;
    sort?: number;
    isHidden?: number;
    type?: MenuType;
    sourceType: MenuSourceType;
};

export type UpdateMenuParams = Partial<CreateMenuParams>;

export type BatchDeleteMenuParams = {
    ids: string[];
};

export type DeleteMenuResult = {
    success: boolean;
    message: string;
};

export type ExtensionMenuItem = {
    name: string;
    identifier: string;
    path: string;
};

const MENU_QUERY_KEY = "menu";

/**
 * Get paginated menu list
 */
export function useMenuListQuery(
    params?: QueryMenuParams,
    options?: QueryOptionsUtil<PaginatedQueryOptionsUtil<Menu>>,
) {
    return useQuery<PaginatedQueryOptionsUtil<Menu>>({
        queryKey: [MENU_QUERY_KEY, "list", params],
        queryFn: () =>
            consoleHttpClient.get<PaginatedQueryOptionsUtil<Menu>>("/menu", {
                params,
            }),
        ...options,
    });
}

/**
 * Get menu tree structure
 */
export function useMenuTreeQuery(options?: QueryOptionsUtil<Menu[]>) {
    return useQuery<Menu[]>({
        queryKey: [MENU_QUERY_KEY, "tree"],
        queryFn: () => consoleHttpClient.get<Menu[]>("/menu/tree", {}),
        ...options,
    });
}

/**
 * Get menu detail by ID
 */
export function useMenuDetailQuery(id: string, options?: QueryOptionsUtil<Menu>) {
    return useQuery<Menu>({
        queryKey: [MENU_QUERY_KEY, "detail", id],
        queryFn: () => consoleHttpClient.get<Menu>(`/menu/${id}`),
        enabled: !!id && options?.enabled !== false,
        ...options,
    });
}

/**
 * Create menu
 */
export function useCreateMenuMutation(options?: MutationOptionsUtil<Menu, CreateMenuParams>) {
    const queryClient = useQueryClient();

    return useMutation<Menu, Error, CreateMenuParams>({
        mutationFn: (data) => consoleHttpClient.post<Menu>("/menu", data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [MENU_QUERY_KEY] });
        },
        ...options,
    });
}

/**
 * Update menu
 */
export function useUpdateMenuMutation(
    options?: MutationOptionsUtil<Menu, { id: string; data: UpdateMenuParams }>,
) {
    const queryClient = useQueryClient();

    return useMutation<Menu, Error, { id: string; data: UpdateMenuParams }>({
        mutationFn: ({ id, data }) => consoleHttpClient.put<Menu>(`/menu/${id}`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [MENU_QUERY_KEY] });
        },
        ...options,
    });
}

/**
 * Delete menu
 */
export function useDeleteMenuMutation(options?: MutationOptionsUtil<DeleteMenuResult, string>) {
    const queryClient = useQueryClient();

    return useMutation<DeleteMenuResult, Error, string>({
        mutationFn: (id) => consoleHttpClient.delete<DeleteMenuResult>(`/menu/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [MENU_QUERY_KEY] });
        },
        ...options,
    });
}

/**
 * Batch delete menus
 */
export function useBatchDeleteMenuMutation(
    options?: MutationOptionsUtil<DeleteMenuResult, BatchDeleteMenuParams>,
) {
    const queryClient = useQueryClient();

    return useMutation<DeleteMenuResult, Error, BatchDeleteMenuParams>({
        mutationFn: (data) => consoleHttpClient.post<DeleteMenuResult>("/menu/batch-delete", data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [MENU_QUERY_KEY] });
        },
        ...options,
    });
}

/**
 * Get enabled extension menus
 */
export function useExtensionMenusQuery(options?: QueryOptionsUtil<ExtensionMenuItem[]>) {
    return useQuery<ExtensionMenuItem[]>({
        queryKey: ["decorate-page", "extension-menus"],
        queryFn: async () => {
            const response = await consoleHttpClient.get<{ data: ExtensionMenuItem[] }>(
                "/decorate-page/extension-menus",
            );
            return response.data;
        },
        ...options,
    });
}
