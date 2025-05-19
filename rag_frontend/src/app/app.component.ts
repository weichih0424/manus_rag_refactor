import { Component, OnInit, PLATFORM_ID, Inject, ApplicationRef } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  title = 'RAG 知識庫系統';
  currentYear: number = new Date().getFullYear();
  paginatedFiles: any[] = [];
  uploadedFiles: any[] = [];

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private appRef: ApplicationRef,
    private router: Router
  ) {}

  ngOnInit() {
    // 初始化工作，只在瀏覽器環境執行
    if (isPlatformBrowser(this.platformId)) {
      // 標記應用程式已穩定，解決水合問題
      setTimeout(() => {
        this.appRef.tick();
        console.log('App marked as stable for hydration');
      }, 0);

      // 監聽路由變化，更新頁面標題
      this.router.events.pipe(
        filter(event => event instanceof NavigationEnd)
      ).subscribe((event: any) => {
        this.updatePageTitle(event.url);
      });
    }
  }

  // 根據當前路由更新頁面標題
  private updatePageTitle(url: string): void {
    let pageTitle = 'RAG 知識庫系統';
    
    if (url === '/') {
      pageTitle = '首頁 | RAG 知識庫系統';
    } else if (url === '/knowledge_base') {
      pageTitle = '知識庫管理 | RAG 知識庫系統';
    } else if (url === '/chat') {
      pageTitle = '聊天 | RAG 知識庫系統';
    } else if (url === '/settings_base') {
      pageTitle = '基本設置 | RAG 知識庫系統';
    } else if (url === '/settings_system') {
      pageTitle = '系統設置 | RAG 知識庫系統';
    }
    
    // 更新頁面標題
    document.title = pageTitle;
  }
}
