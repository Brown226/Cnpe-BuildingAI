import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";

import { createAbortError, createRequestId } from "../utils/helpers";
import { mergeRequestConfig, type RequestConfig } from "../utils/request";
import { type HeadersInput, type HttpClientOptions, HttpError } from "./types";

function trimSlashStart(v: string): string {
    return v.replace(/^\/+/, "");
}

function trimSlashEnd(v: string): string {
    return v.replace(/\/+$/, "");
}

function isAbsoluteUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
}

function joinPrefix(url: string, prefix?: string): string {
    if (!prefix) return url;
    if (!url) return url;
    if (isAbsoluteUrl(url)) return url;

    const p = trimSlashEnd(prefix);
    const u = trimSlashStart(url);

    if (!p) return `/${u}`;

    return `${p}/${u}`;
}

function normalizeHeaders(headers?: HeadersInput): Record<string, string> | undefined {
    if (!headers) return undefined;

    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
        if (v === undefined || v === null) continue;
        out[k] = String(v);
    }
    return out;
}

function isAxiosError(error: unknown): error is AxiosError {
    return (
        Boolean(error) && typeof error === "object" && (error as AxiosError).isAxiosError === true
    );
}

function toHttpError(error: unknown): HttpError {
    if (error instanceof HttpError) return error;

    if (isAxiosError(error)) {
        const status = error.response?.status;
        const code = error.code;
        const responseData = error.response?.data as Record<string, unknown> | undefined;
        const message =
            (typeof responseData?.message === "string" && responseData.message) ||
            error.message ||
            "Request failed";
        return new HttpError({
            name: "HttpRequestError",
            message,
            code,
            status,
            details: {
                url: error.config?.url,
                method: error.config?.method,
                data: responseData,
            },
            cause: error,
        });
    }

    if (error instanceof Error) {
        return new HttpError({
            name: error.name || "UnknownError",
            message: error.message || "Unknown error",
            cause: error,
        });
    }

    return new HttpError({
        name: "UnknownError",
        message: "Unknown error",
        cause: error,
    });
}

function isAccessError(error: HttpError): boolean {
    const responseData =
        error.details && typeof error.details === "object" && "data" in error.details
            ? (error.details.data as { code?: unknown } | undefined)
            : undefined;
    const businessCode = error.code ?? responseData?.code;
    return String(businessCode) === "40203";
}

/**
 * 服务端滑动续期响应头（与 api AuthGuard.handleTokenRefresh 对齐）：
 * token 接近过期时服务端经该头下发新 token，客户端消费并持久化。
 */
const NEW_TOKEN_HEADER = "x-new-token";

function readResponseHeader(
    headers: Record<string, unknown> | undefined,
    name: string,
): string | undefined {
    if (!headers) return undefined;
    // AxiosHeaders 实例：get() 不区分大小写
    if (typeof (headers as { get?: (n: string) => unknown }).get === "function") {
        const viaGet = (headers as { get: (n: string) => unknown }).get(name);
        if (typeof viaGet === "string" && viaGet) return viaGet;
    }
    // 普通对象回退：axios 规范化后 key 为小写
    const viaIndex = headers[name.toLowerCase()] ?? headers[name];
    return typeof viaIndex === "string" && viaIndex ? viaIndex : undefined;
}

export class HttpClient {
    private readonly axios: AxiosInstance;
    private readonly options: HttpClientOptions;
    private unwrapOrThrow<TResponse>(raw: unknown): TResponse {
        if (this.options.parseResponse) {
            const result = this.options.parseResponse<TResponse>(raw);
            if (result.ok) return result.data;
            throw result.error;
        }

        return raw as TResponse;
    }

    public constructor(options: HttpClientOptions = {}) {
        this.options = options;
        this.axios = axios.create({
            baseURL: options.baseURL,
            timeout: options.timeoutMs,
            withCredentials: options.withCredentials,
            headers: normalizeHeaders(options.headers),
        });

        this.setupInterceptors();
    }

    public get instance(): AxiosInstance {
        return this.axios;
    }

    public async request<TResponse>(config: RequestConfig): Promise<TResponse> {
        const silent = config.silent ?? false;

        const requestId = config.requestId ?? createRequestId();
        const mergedConfig: AxiosRequestConfig = mergeRequestConfig({}, config);

        if (typeof mergedConfig.url === "string") {
            mergedConfig.url = joinPrefix(mergedConfig.url, this.options.pathPrefix);
        }

        mergedConfig.headers = mergedConfig.headers ?? {};
        (mergedConfig.headers as Record<string, string>)["x-request-id"] = requestId;

        try {
            const res = await this.axios.request(mergedConfig);
            if (res.status === 204) {
                return undefined as TResponse;
            }
            const raw = res.data as unknown;
            return this.unwrapOrThrow<TResponse>(raw);
        } catch (error) {
            if (
                (error instanceof DOMException && error.name === "AbortError") ||
                (isAxiosError(error) && error.code === "ERR_CANCELED")
            ) {
                throw createAbortError();
            }

            const status = isAxiosError(error) ? error.response?.status : undefined;

            if (status === 401 && this.options.hooks?.refreshAccessToken) {
                const refreshed = await this.options.hooks.refreshAccessToken();
                if (refreshed) {
                    try {
                        const res = await this.axios.request(mergedConfig);
                        if (res.status === 204) {
                            return undefined as TResponse;
                        }
                        const raw = res.data as unknown;
                        return this.unwrapOrThrow<TResponse>(raw);
                    } catch (retryError) {
                        if (this.options.hooks?.onAuthError) {
                            await this.options.hooks.onAuthError(retryError);
                        }
                        throw toHttpError(retryError);
                    }
                }
            }

            if (status === 401) {
                if (this.options.hooks?.onAuthError) {
                    await this.options.hooks.onAuthError(error);
                }
                throw toHttpError(error);
            }

            const httpError = toHttpError(error);
            if (!silent && isAccessError(httpError)) {
                await this.options.hooks?.onAccessError?.(httpError);
            } else if (!silent) {
                this.options.hooks?.onError?.(httpError);
            }
            throw httpError;
        }
    }

    public get<TResponse>(url: string, config: RequestConfig = {}): Promise<TResponse> {
        return this.request<TResponse>({ ...config, url, method: "GET" });
    }

    public post<TResponse, TBody = unknown>(
        url: string,
        data?: TBody,
        config: RequestConfig = {},
    ): Promise<TResponse> {
        return this.request<TResponse>({ ...config, url, data, method: "POST" });
    }

    public put<TResponse, TBody = unknown>(
        url: string,
        data?: TBody,
        config: RequestConfig = {},
    ): Promise<TResponse> {
        return this.request<TResponse>({ ...config, url, data, method: "PUT" });
    }

    public patch<TResponse, TBody = unknown>(
        url: string,
        data?: TBody,
        config: RequestConfig = {},
    ): Promise<TResponse> {
        return this.request<TResponse>({ ...config, url, data, method: "PATCH" });
    }

    public delete<TResponse>(url: string, config: RequestConfig = {}): Promise<TResponse> {
        return this.request<TResponse>({ ...config, url, method: "DELETE" });
    }

    public async download(url: string, config: RequestConfig = {}): Promise<Blob> {
        return this.request<Blob>({
            ...config,
            url,
            method: "GET",
            responseType: "blob",
        });
    }

    public async upload<TResponse>(
        url: string,
        form: FormData,
        config: RequestConfig = {},
    ): Promise<TResponse> {
        return this.request<TResponse>({
            ...config,
            url,
            method: "POST",
            data: form,
        });
    }

    private setupInterceptors(): void {
        this.axios.interceptors.request.use(async (cfg) => {
            const tokenGetter = this.options.hooks?.getAccessToken;
            if (tokenGetter) {
                const token = await tokenGetter();
                if (token) {
                    cfg.headers = cfg.headers ?? {};
                    (cfg.headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
                }
            }
            return cfg;
        });

        this.axios.interceptors.response.use(
            (res) => {
                // 服务端滑动续期：消费 x-new-token，写入调用方存储（auth store / 插件 cookie）
                const refreshed = readResponseHeader(res.headers as Record<string, unknown>, NEW_TOKEN_HEADER);
                if (refreshed) {
                    void this.options.hooks?.onTokenRefreshed?.(refreshed);
                }
                return res;
            },
            (error: unknown) => Promise.reject(error),
        );
    }
}
