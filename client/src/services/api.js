import axios from 'axios';

const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

const api = axios.create({
    baseURL: API_URL
});

// Track whether a refresh is already in-flight to avoid duplicate refresh calls
let isRefreshing = false;
let refreshSubscribers = [];

function onTokenRefreshed(newAccessToken) {
    refreshSubscribers.forEach(callback => callback(newAccessToken));
    refreshSubscribers = [];
}

function addRefreshSubscriber(callback) {
    refreshSubscribers.push(callback);
}

// Request interceptor — attach access token to every outgoing request
api.interceptors.request.use(
    (config) => {
        const accessToken = localStorage.getItem('accessToken');
        if (accessToken) {
            config.headers.Authorization = `Bearer ${accessToken}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor — silently refresh on 401/403
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Only attempt refresh for auth errors, and not on the refresh endpoint itself
        const isAuthError = error.response && (error.response.status === 401 || error.response.status === 403);
        const isRefreshRequest = originalRequest.url?.includes('/api/auth/refresh');

        if (isAuthError && !isRefreshRequest && !originalRequest._retry) {
            originalRequest._retry = true;

            if (isRefreshing) {
                // Another refresh is in-flight — queue this request
                return new Promise((resolve) => {
                    addRefreshSubscriber((newAccessToken) => {
                        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                        resolve(api(originalRequest));
                    });
                });
            }

            isRefreshing = true;

            try {
                const refreshToken = localStorage.getItem('refreshToken');

                if (!refreshToken) {
                    throw new Error('No refresh token');
                }

                const { data } = await axios.post(`${API_URL}/api/auth/refresh`, {
                    refreshToken
                });

                // Store the new rotated tokens
                localStorage.setItem('accessToken', data.accessToken);
                localStorage.setItem('refreshToken', data.refreshToken);

                isRefreshing = false;
                onTokenRefreshed(data.accessToken);

                // Retry the original request with the new token
                originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
                return api(originalRequest);
            } catch (refreshError) {
                isRefreshing = false;
                refreshSubscribers = [];

                // Refresh failed — session is dead, force re-login
                localStorage.removeItem('accessToken');
                localStorage.removeItem('refreshToken');
                localStorage.removeItem('user');
                window.location.href = '/login';

                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

export default api;
