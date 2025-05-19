import { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { inject } from '@angular/core';
import { PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);
  
  return next(req).pipe(
    catchError(error => {
      let errorMessage = '';
      
      // 檢查是否在瀏覽器環境並處理客戶端錯誤
      if (isPlatformBrowser(platformId) && error.error instanceof ErrorEvent) {
        // 客戶端錯誤
        errorMessage = `錯誤: ${error.error.message}`;
      } else {
        // 服務器端錯誤
        const status = error.status || 0;
        const message = error.error?.error || error.message || '未知錯誤';
        errorMessage = `服務器返回代碼: ${status}, 錯誤信息: ${message}`;
        
        // 針對連接問題提供更明確的錯誤訊息
        if (status === 0) {
          errorMessage = '無法連接到後端伺服器，請確認伺服器是否運行或檢查網路連接';
          console.error('連接錯誤: 無法連接到後端伺服器', req.url);
        }
      }
      
      console.error(errorMessage);
      return throwError(() => new Error(errorMessage));
    })
  );
}; 