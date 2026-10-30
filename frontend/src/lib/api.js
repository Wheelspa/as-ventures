import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const getToken = () => localStorage.getItem("sa_token");
export const setToken = (t) => localStorage.setItem("sa_token", t);
export const clearToken = () => localStorage.removeItem("sa_token");

export const api = axios.create({ baseURL: API });
api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});
api.interceptors.response.use((r) => r, (e) => {
  if (e?.response?.status === 401 && getToken() && !e.config.url.includes("/auth/")) {
    clearToken();
    window.location.href = "/";
  }
  return Promise.reject(e);
});

export const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => `${x.loc?.slice(-1)[0] || ""}: ${x.msg}`).join(", ");
  return e?.message || "Something went wrong";
};

export async function openBlob(path, filename, params) {
  const r = await api.get(path, { params, responseType: "blob" });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  else a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await api.post("/documents", fd);
  return r.data;
}
