import EventEmitter from '../battle-history/scripts/eventEmitter.js';
import { GAME_POINTS, STATS } from '../battle-history/scripts/constants.js';

class CoreService {
  constructor() {
    try {
      this.sdk = new WotstatWidgetsSdk.WidgetSDK();
    } catch (error) {
      console.error('Failed to initialize SDK:', error);
      throw error;
    }

    const savedState = localStorage.getItem('gameState');
    if (savedState) {
      const state = JSON.parse(savedState);
      this.BattleStats = state.BattleStats || {};
      this.PlayersInfo = state.PlayersInfo || {};
      this.curentPlayerId = state.curentPlayerId || null;
      this.curentArenaId = state.curentArenaId || null;
      this.curentVehicle = state.curentVehicle || null;
      this.isInPlatoon = state.isInPlatoon || false;
    } else {
      this.BattleStats = {};
      this.PlayersInfo = {};
      this.curentPlayerId = this.sdk.data.player.id.value;
      this.curentArenaId = null;
      this.curentVehicle = null;
      this.isInPlatoon = false;
    }

    this.isSaving = false;
    this.setupSDKListeners();
    this.eventsCore = new EventEmitter();
    this.setupWebSocket();
    this.loadFromServer();


    setInterval(() => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.setupWebSocket();
      }
    }, 30000);
  }

    setupWebSocket() {
    const accessKey = this.getAccessKey();
    if (!accessKey || !this.curentPlayerId) return;

    const baseUrl = atob(STATS.WS);
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${baseUrl}?playerId=${this.curentPlayerId}`;

    if (this.ws) {
      this.ws.close();
    }

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {

    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.success) {
          this.isSaving = true;
        }
      } catch (error) {
        console.error('Помилка обробки WebSocket повідомлення:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket помилка:', error);
    };

    this.ws.onclose = () => {
      
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getRandomDelay() {
    const min = 50;
    const max = 200;
    return this.sleep(Math.floor(Math.random() * (max - min + 5)) + min);
  }

  setupSDKListeners() {
    this.sdk.data.hangar.isInHangar.watch(this.handleHangarStatus.bind(this));
    this.sdk.data.hangar.vehicle.info.watch(this.handleHangarVehicle.bind(this));
    this.sdk.data.platoon.isInPlatoon.watch(this.handlePlatoonStatus.bind(this));
    this.sdk.data.battle.arena.watch(this.handleArena.bind(this));
    this.sdk.data.battle.onDamage.watch(this.handleOnAnyDamage.bind(this));
    this.sdk.data.battle.onPlayerFeedback.watch(this.handlePlayerFeedback.bind(this));
    this.sdk.data.battle.onBattleResult.watch(this.handleBattleResult.bind(this));
  }

  saveState() {
    const state = {
      BattleStats: this.BattleStats,
      PlayersInfo: this.PlayersInfo,
      curentPlayerId: this.curentPlayerId,
      curentArenaId: this.curentArenaId,
      curentVehicle: this.curentVehicle,
      isInPlatoon: this.isInPlatoon
    };
    localStorage.setItem('gameState', JSON.stringify(state));
  }

  clearState() {
    localStorage.removeItem('gameState');
    if (this.ws) {
      this.ws.close();
    }

    this.BattleStats = {};
    this.PlayersInfo = {};
    this.curentPlayerId = this.sdk.data.player.id.value;
    this.curentArenaId = null;
    this.curentVehicle = null;
    this.isInPlatoon = false;

    this.setupWebSocket();
  }

  initializeBattleStats(arenaId, playerId) {
    if (!this.BattleStats[arenaId]) {
      this.BattleStats[arenaId] = {
        startTime: Date.now(),
        duration: 0,
        win: -1,
        mapName: 'Unknown Map',
        players: {}
      };
    }

    if (!this.BattleStats[arenaId].players[playerId]) {
      this.BattleStats[arenaId].players[playerId] = {
        name: this.PlayersInfo[playerId] || 'Unknown Player',
        damage: 0,
        kills: 0,
        points: 0,
        vehicle: this.curentVehicle || 'Unknown Vehicle'
      };
    }
  }

  getPlayer(id) {
    return this.PlayersInfo[id] || null;
  }

  getPlayersIds() {
    return Object.keys(this.PlayersInfo || {});
  }

  calculatePlayerData(playerId) {
    let playerPoints = 0;
    let playerDamage = 0;
    let playerKills = 0;

    try {
      for (const arenaId in this.BattleStats) {
        const player = this.BattleStats[arenaId].players[playerId];
        if (player) {
          playerPoints += player.points || 0;
          playerDamage += player.damage || 0;
          playerKills += player.kills || 0;
        }
      }
    } catch (error) {
      console.error('Помилка при розрахунку загальних очок гравця:', error);
    }

    return { playerPoints, playerDamage, playerKills };
  }

  calculateTeamData() {
    let teamPoints = 0;
    let teamDamage = 0;
    let teamKills = 0;
    let wins = 0;
    let battles = 0;

    try {
      for (const arenaId in this.BattleStats) {
        battles++;
        if (this.BattleStats[arenaId].win === 1) {
          teamPoints += GAME_POINTS.POINTS_PER_TEAM_WIN;
          wins++;
        }

        for (const playerId in this.BattleStats[arenaId].players) {
          const player = this.BattleStats[arenaId].players[playerId];
          teamPoints += player.points || 0;
          teamDamage += player.damage || 0;
          teamKills += player.kills || 0;
        }
      }
    } catch (error) {
      console.error('Помилка при розрахунку загальних очок команди:', error);
    }

    return { teamPoints, teamDamage, teamKills, wins, battles };
  }

  getAccessKey() {
    return localStorage.getItem('accessKey');
  }

  async saveToServer(retries = 2) {
    const accessKey = this.getAccessKey();
    if (!accessKey) {
      throw new Error('Access key not found');
    }

    this.isSaving = false;

    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${atob(STATS.BATTLE)}${accessKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Player-ID': this.curentPlayerId
          },
          body: JSON.stringify({
            BattleStats: this.BattleStats,
            PlayerInfo: this.PlayersInfo,
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok && response.status !== 202) {
          throw new Error(`Server error: ${response.status}`);
        }

        return true;

      } catch (error) {
        console.error(`Attempt ${i + 1} failed:`, error);
        if (i === retries - 1) throw error;
        await this.sleep(750 * (i + 1));
      }
    }
    return false;
  }


  async loadFromServer() {
    try {
      const accessKey = this.getAccessKey();
      if (!accessKey) {
        throw new Error('Access key not found');
      }

      const response = await fetch(`${atob(STATS.BATTLE)}${accessKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Помилка при завантаженні даних: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        if (data.BattleStats) {
          this.BattleStats = data.BattleStats;
        }
        if (data.PlayerInfo) {
          this.PlayersInfo = data.PlayerInfo;
        }
      }
      return true;
    } catch (error) {
      console.error('Помилка при завантаженні даних із сервера:', error);
      throw error;
    }
  }

  async clearServerData() {
    try {
      const accessKey = this.getAccessKey();
      const response = await fetch(`${atob(STATS.CLEAR)}${accessKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });

      if (!response.ok) {
        throw new Error(`Помилка при очищенні даних: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        this.BattleStats = {};
        this.PlayersInfo = {};
        this.eventsCore.emit('statsUpdated');
      }

    } catch (error) {
      console.error('Помилка при очищенні даних на сервері:', error);
      throw error;
    }
  }

  async serverDataLoad() {
    try {
      if (!this.isSaving) return;
      await this.loadFromServer();
      this.sleep(300);
      this.eventsCore.emit('statsUpdated');
      this.saveState();
    } catch (error) {
      console.error('Error in serverDataLoad:', error);
    }
  }

  async serverDataSave() {
    try {
      this.getRandomDelay();
      await this.saveToServer();
    } catch (error) {
      console.error('Error in serverDataSave:', error);
    }
  }

  async serverData() {
    try {
      await this.saveToServer();
      this.sleep(300);
      if (!this.isSaving) return;
      await this.loadFromServer();
      this.sleep(300);
      this.eventsCore.emit('statsUpdated');
      this.saveState();
    } catch (error) {
      console.error('Error in serverData:', error);
    }
  }

  handlePlatoonStatus(isInPlatoon) {
    this.isInPlatoon = isInPlatoon;
    this.saveState();
  }

  handleHangarStatus(isInHangar) {
    if (!isInHangar) return;

    const playersID = this.getPlayersIds();
    this.curentPlayerId = this.sdk.data.player.id.value;

    if (this.curentPlayerId === null) return;
    if ((this.isInPlatoon && playersID.length > 3) || (!this.isInPlatoon && playersID.length >= 1)) {
      return;
    }

    this.PlayersInfo[this.curentPlayerId] = this.sdk.data.player.name.value;

    this.serverData();
  }

  handleHangarVehicle(hangareVehicleData) {
    if (!hangareVehicleData) return;
    this.curentVehicle = hangareVehicleData.localizedShortName || 'Unknown Vehicle';
  }

  handleArena(arenaData) {
    if (!arenaData) return;

    this.curentArenaId = this.sdk?.data?.battle?.arenaId?.value ?? null;

    if (this.curentArenaId == null) return;
    if (this.curentPlayerId == null) return;

    this.initializeBattleStats(this.curentArenaId, this.curentPlayerId);

    this.BattleStats[this.curentArenaId].mapName = arenaData.localizedName || 'Unknown Map';
    this.BattleStats[this.curentArenaId].players[this.curentPlayerId].vehicle = this.curentVehicle;
    this.BattleStats[this.curentArenaId].players[this.curentPlayerId].name = this.sdk.data.player.name.value;

    this.serverDataSave();
  }

  handleOnAnyDamage(onDamageData) {
    if (!onDamageData || !this.curentArenaId || !this.sdk.data.player.id.value) return;

    const playersID = this.getPlayersIds();
    for (const playerId of playersID) {
      if (onDamageData.attacker.playerId === playerId && playerId !== this.sdk.data.player.id.value) {
        this.serverDataLoad();
        break;
      }
    }
  }

  handlePlayerFeedback(feedback) {
    if (!feedback || !feedback.type) return;

    switch (feedback.type) {
      case 'damage':
        this.handlePlayerDamage(feedback.data);
        break;
      case 'kill':
        this.handlePlayerKill(feedback.data);
        break;
      case 'radioAssist':
        this.handlePlayerRadioAssist(feedback.data);
        break;
      case 'trackAssist':
        this.handlePlayerTrackAssist(feedback.data);
        break;
      case 'tanking':
        this.handlePlayerTanking(feedback.data);
        break;
      case 'receivedDamage':
        this.handlePlayerReceivedDamage(feedback.data);
        break;
    }
  }

  handlePlayerDamage(damageData) {
    if (!damageData || !this.curentArenaId || !this.curentPlayerId) return;

    const arenaId = this.curentArenaId;
    const playerId = this.curentPlayerId;

    this.BattleStats[arenaId].players[playerId].damage += damageData.damage;
    this.BattleStats[arenaId].players[playerId].points += damageData.damage * GAME_POINTS.POINTS_PER_DAMAGE;

    this.serverData();
  }

  handlePlayerKill(killData) {
    if (!killData || !this.curentArenaId || !this.curentPlayerId) return;

    const arenaId = this.curentArenaId;
    const playerId = this.curentPlayerId;

    this.BattleStats[arenaId].players[playerId].kills += 1;
    this.BattleStats[arenaId].players[playerId].points += GAME_POINTS.POINTS_PER_FRAG;

    this.serverData();
  }

  handlePlayerRadioAssist(radioAssist) {
    if (!radioAssist || !this.curentArenaId || !this.curentPlayerId) return;
    this.serverDataLoad();
  }

  handlePlayerTrackAssist(trackAssist) {
    if (!trackAssist || !this.curentArenaId || !this.curentPlayerId) return;
    this.serverDataLoad();
  }

  handlePlayerTanking(tanking) {
    if (!tanking || !this.curentArenaId || !this.curentPlayerId) return;
    this.serverDataLoad();
  }

  handlePlayerReceivedDamage(receivedDamage) {
    if (!receivedDamage || !this.curentArenaId || !this.curentPlayerId) return;
    this.serverDataLoad();
  }

  handleBattleResult(result) {
    if (!result || !result.vehicles || !result.players) {
      console.error("Invalid battle result data");
      return;
    }

    const arenaId = result.arenaUniqueID;
    if (!arenaId) return;

    this.curentPlayerId = Object.keys(result.avatars)[0];
    this.BattleStats[arenaId].duration = result.common.duration;

    console.log("this.curentPlayerId",this.curentPlayerId);
    
    const playerTeam = Number(result.players[this.curentPlayerId].team);
    const winnerTeam = Number(result.common.winnerTeam);

    console.log("playerTeam", playerTeam);
    console.log("winnerTeam", winnerTeam);


    if (playerTeam !== undefined && playerTeam !== 0 && winnerTeam !== undefined) {
      if (playerTeam === winnerTeam) {
        this.BattleStats[arenaId].win = 1;
      } else if (winnerTeam === 0) {
        this.BattleStats[arenaId].win = 2;
      } else {
        this.BattleStats[arenaId].win = 0;
      }
    }

    const playerIds = this.getPlayersIds();
    for (const playerId of playerIds) {
      for (const vehicleId in result.vehicles) {
        const vehicles = result.vehicles[vehicleId];
        for (const vehicle of vehicles) {
          if (vehicle.accountDBID === playerId) {
            const playerStats = this.BattleStats[arenaId].players[playerId];
            playerStats.damage = vehicle.damageDealt;
            playerStats.kills = vehicle.kills;
            playerStats.points = vehicle.damageDealt + (vehicle.kills * GAME_POINTS.POINTS_PER_FRAG);
            break;
          }
        }
      }
    }
    this.serverDataSave();
    this.sleep(1500);
    this.serverDataLoad();
  }

  cleanup() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

export default CoreService;