import CoreService from './coreService.js';
import UIService from './uiService.js';
import { STATS } from '../battle-history/scripts/constants.js';

export default class SquadWidget {
  constructor() {
    this.init();
  }

  async init() {
    try {

      await this.warmupServer();
      const hasAccess = await this.checkAccessKey();
      if (!hasAccess) {
        this.showAccessDenied();
        return;
      }
      this.initializeServices();
    } catch (error) {
      console.error('Error in init:', error);
      this.showAccessDenied();
    }
  }
  initializeServices() {
    try {
      this.coreService = new CoreService();
      this.uiService = new UIService(this.coreService);
      this.initialize();
    } catch (error) {
      console.error('Error initializing services:', error);
    }
  }

  initialize() {
    try {
      this.coreService.loadFromServer();
      this.uiService.updatePlayersUI();
    } catch (error) {
      console.error('Error in initialize:', error);
    }
  }

async warmupServer() {
  try {
    const warmupUrl = `${atob(STATS.BATTLE)}ping`;
    console.log("Warming up server...");
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(warmupUrl, {
      method: 'GET',
      signal: controller.signal
    }).catch(err => {
      console.log("Server warmup request failed, continuing anyway");
      return null;
    });
    
    clearTimeout(timeoutId);
    console.log("Server warmed up");
    
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    console.log("Error warming up server, continuing anyway:", error);
  }
}

  async checkAccessKey() {
    try {
      localStorage.removeItem('accessKey');
      const urlParams = window.location.search.substring(1);
      
      if (!urlParams) {
        return false;
      }
  
      const apiUrl = `${atob(STATS.BATTLE)}${urlParams}`;
  
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
  
      if (response.status === 401) {
        return false;
      }
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const data = await response.json();
  
      if (data.success) {
        localStorage.setItem('accessKey', urlParams);
        return true;
      }
      
      return false;
  
    } catch (error) {
      if (!(error instanceof Response) || error.status !== 401) {
        console.error('Error in checkAccessKey:', error);
      }
      return false;
    }
  }

  showAccessDenied() {
    try {
      const container = document.createElement('div');
      container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: var(--wotstat-background,rgba(255, 255, 255, 0));
        z-index: 9999;
      `;

      const message = document.createElement('div');
      message.style.cssText = `
        text-align: center;
        padding: 2em;
        border-radius: 1em;
        background-color: rgba(0, 0, 0, 0.7);
        color: var(--wotstat-primary, #ffffff);
      `;

      message.innerHTML = `
        <h2>Доступ заборонено</h2>
        <p>Невірний ключ доступу</p>
      `;

      container.appendChild(message);

      document.body.innerHTML = '';
      document.body.appendChild(container);
    } catch (error) {
      console.error('Error in showAccessDenied:', error);
    }
  }
}
