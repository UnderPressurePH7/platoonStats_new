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
    }

    this.setupSDKListeners();
    this.eventsCore = new EventEmitter();
    this.loadFromServer();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

    this.BattleStats = {};
    this.PlayersInfo = {};
    this.curentPlayerId = this.sdk.data.player.id.value;
    this.curentArenaId = null;
    this.curentVehicle = null;
    this.isInPlatoon = false;
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

  getRandomDelay() {
    const min = 50;
    const max = 200;
    const delay = Math.floor(Math.random() * (max - min + 5)) + min;
    return this.sleep(delay);
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
        await this.sleep(750 * (i + 1)); // Експоненціальна затримка
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
      await this.loadFromServer();
      this.eventsCore.emit('statsUpdated');
      await this.sleep(100);
      this.saveState();
    } catch (error) {
      console.error('Error in serverData:', error);
    }
  }


  async serverData() {
    try {
      await this.saveToServer();
      await this.sleep(100);
      await this.loadFromServer();
      this.eventsCore.emit('statsUpdated');
      await this.sleep(100);
      this.saveState();
    } catch (error) {
      console.error('Error in serverData:', error);
    }
  }

  // ОБРОБНИКИ ПОДІЙ В ГАРАЖІ

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

    this.serverData()
  }

  handleHangarVehicle(hangareVehicleData) {
    if (!hangareVehicleData) return;
    this.curentVehicle = hangareVehicleData.localizedShortName || 'Unknown Vehicle';
  }




  // ОБРОБНИК ПОДІЙ АРЕНИ
  handleArena(arenaData) {
    if (!arenaData) return;

    this.curentArenaId = this.sdk?.data?.battle?.arenaId?.value ?? null;

    if (this.curentArenaId == null) return;
    if (this.curentPlayerId == null) return;

    this.initializeBattleStats(this.curentArenaId, this.curentPlayerId);


    this.BattleStats[this.curentArenaId].mapName = arenaData.localizedName || 'Unknown Map';
    this.BattleStats[this.curentArenaId].players[this.curentPlayerId].vehicle = this.curentVehicle;
    this.BattleStats[this.curentArenaId].players[this.curentPlayerId].name = this.sdk.data.player.name.value;

    this.serverData();
  }

  // ПОДІЯ НА НАНЕСЕННЯ ШКОДИ В КОЛІ ВІДМАЛЬВКИ
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

  // ОБРОБНИКИ ПОДІЙ ПОВ'ЯЗАНИХ ІЗ ДІЯМИ ГРАВЦЯ
  handlePlayerFeedback(feedback) {
    if (!feedback || !feedback.type) return;

    if (feedback.type === 'damage') {
      this.handlePlayerDamage(feedback.data);
    } else if (feedback.type === 'kill') {
      this.handlePlayerKill(feedback.data);
    } else if (feedback.type === 'radioAssist') {
      this.handlePlayerRadioAssist(feedback.data);
    } else if (feedback.type === 'trackAssist') {
      this.handlePlayerTrackAssist(feedback.data);
    } else if (feedback.type === 'tanking') {
      this.handlePlayerTanking(feedback.data);
    } else if (feedback.type === 'receivedDamage') {
      this.handlePlayerReceivedDamage(feedback.data);
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
    // асист по розвідці
    this.serverDataLoad();
  }


  handlePlayerTrackAssist(trackAssist) {
    if (!trackAssist || !this.curentArenaId || !this.curentPlayerId) return;
    // асист по гуслях
    this.serverDataLoad();
  }

  handlePlayerTanking(tanking) {
    if (!tanking || !this.curentArenaId || !this.curentPlayerId) return;
    // заблоковано шкоди
    this.serverDataLoad();
  }

  handlePlayerReceivedDamage(receivedDamage) {
    if (!receivedDamage || !this.curentArenaId || !this.curentPlayerId) return;
    // шкода завдана по гравцеві
    this.serverDataLoad();
  }

  // РЕЗУЛЬТАТИ БОЮ  
  handleBattleResult(result) {
    if (!result || !result.vehicles || !result.players) {
      console.error("Invalid battle result data");
      return;
    }

    const arenaId = result.arenaUniqueID;
    if (!arenaId) return;

    this.curentPlayerId = Object.keys(result.avatars)[0];
    this.BattleStats[arenaId].duration = result.common.duration;

    const playerTeam = Number(result.players[this.curentPlayerId].team);
    const winnerTeam = Number(result.common.winnerTeam);

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
            this.saveState();
            // this.saveToServer(playerId); // помилка, сервер лягає
            break;
          }
        }
      }
    }
    this.getRandomDelay();
    this.saveToServer();
    this.sleep(500);
    this.serverDataLoad;
  }
}

export default CoreService;
