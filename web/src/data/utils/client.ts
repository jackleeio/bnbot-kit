import { SearchParamOptions } from '@/types';
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

export const Axios = axios.create({
  baseURL: process.env.NEXT_PUBLIC_REST_API_ENDPOINT,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
  // 关键：让浏览器自动发送 httpOnly Cookie
  withCredentials: true,
});

// 用于防止多个请求同时响应 401 错误
let isHandlingUnauth = false;
let failedQueue: Array<{
  resolve: () => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
};

const redirectToLogin = () => {
  if (typeof window !== 'undefined') {
    // httpOnly Cookie 由后端清除，前端只需清除用户状态
    localStorage.removeItem('userData.bnbot');
    // 触发页面刷新，让应用回到未登录状态
    window.location.reload();
  }
};

// 请求拦截器 - 自动添加 API Key (如需要)
Axios.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // 如果需要 x-api-key，添加到 header
    if (process.env.NEXT_PUBLIC_X_API_KEY && config.headers) {
      config.headers['x-api-key'] = process.env.NEXT_PUBLIC_X_API_KEY;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器 - 处理 401 错误
Axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 如果是 401（未认证）错误，清除状态并重定向登录
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isHandlingUnauth) {
        // 正在处理中，等待其他请求
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        });
      }

      originalRequest._retry = true;
      isHandlingUnauth = true;

      try {
        // 尝试调用 refresh 端点（从 Cookie 自动读取 refresh_token）
        await axios.post(
          `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/refresh`,
          {},
          {
            headers: { 'Content-Type': 'application/json' },
            withCredentials: true
          }
        );

        // 刷新成功，继续原始请求
        processQueue(null);
        return Axios(originalRequest);
      } catch (refreshError) {
        // refresh_token 也过期了，需要重新登录
        processQueue(refreshError);
        redirectToLogin();
        return Promise.reject(refreshError);
      } finally {
        isHandlingUnauth = false;
      }
    }

    return Promise.reject(error);
  }
);

const responseBody = (response: AxiosResponse) => response.data;

export class HttpClient {
  static async get<T>(url: string, params?: unknown) {
    const response = await Axios.get<T>(url, { params });
    return response.data;
  }

  static async post<T>(url: string, data: unknown, options?: any) {
    const response = await Axios.post<T>(url, data, options);
    return response.data;
  }

  static async put<T>(url: string, data: unknown) {
    const response = await Axios.put<T>(url, data);
    return response.data;
  }

  static async delete<T>(url: string) {
    const response = await Axios.delete<T>(url);
    return response.data;
  }

  static formatSearchParams(params: Partial<SearchParamOptions>) {
    return Object.entries(params)
      .filter(([, value]) => Boolean(value))
      .map(([k, v]) =>
        ['type', 'categories', 'id', 'name'].includes(k)
          ? `${k}.slug:${v}`
          : `${k}:${v}`,
      )
      .join(';');
  }
}
