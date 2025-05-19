import { HttpInterceptorFn } from '@angular/common/http';

export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  // 複製請求並添加 withCredentials
  const modifiedReq = req.clone({
    withCredentials: true
  });
  
  // 返回修改後的請求
  return next(modifiedReq);
};  
