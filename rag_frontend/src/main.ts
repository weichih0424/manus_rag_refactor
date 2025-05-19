import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';

// 添加這些配置來解決水合問題
(window as any).__zone_symbol__UNPATCHED_EVENTS = ['scroll', 'mousemove', 'resize', 'mousedown', 'mouseup', 'click'];
(window as any).__Zone_disable_ZoneAwarePromise = true; // 禁用 Zone.js 對 Promise 的包裝
(window as any).ngSkipHydration = true; // 完全跳過水合過程
(window as any).__Zone_disable_timers = true; // 禁用 Zone.js 計時器監控

// 延長水合超時時間並添加更多配置
const extraConfig: ApplicationConfig = {
  providers: [
    {
      provide: 'HYDRATION_TIMEOUT',
      useValue: 60000 // 加長到60秒
    }
  ]
};

const finalConfig = mergeApplicationConfig(appConfig, extraConfig);

bootstrapApplication(AppComponent, finalConfig)
  .catch((err) => console.error(err));
