/* eslint-disable class-methods-use-this */
import { NameRegistryState } from "@solana/spl-name-service";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  AccountImportedChannelData,
  addressSlicer,
  BasePopupChannelData,
  BillboardEvent,
  BROADCAST_CHANNELS,
  BROADCAST_CHANNELS_MSGS,
  broadcastChannelOptions,
  Contact,
  ContactPayload,
  DEFAULT_PREFERENCES,
  DiscoverDapp,
  NetworkChangeChannelData,
  PopupData,
  PopupStoreChannel,
  ProviderConfig,
  randomId,
  SelectedAddresssChangeChannelData,
  ThemeChannelData,
  TX_EVENTS,
} from "@toruslabs/base-controllers";
import { BroadcastChannel } from "@toruslabs/broadcast-channel";
import { BasePostMessageStream } from "@toruslabs/openlogin-jrpc";
import { LOGIN_PROVIDER_TYPE, storageAvailable } from "@toruslabs/openlogin-utils";
import { ExtendedAddressPreferences, LoadingState, NFTInfo, SolanaToken, SolanaTransactionActivity } from "@toruslabs/solana-controllers";
import { BigNumber } from "bignumber.js";
import { cloneDeep, merge, omit } from "lodash-es";
import log from "loglevel";
import { VueI18nTranslation } from "vue-i18n";
// import { i18n } from "@/plugins/i18nPlugin";
import { Action, getModule, Module, Mutation, VuexModule } from "vuex-module-decorators";

import OpenLoginFactory from "@/auth/OpenLogin";
import TorusController, { DEFAULT_CONFIG, DEFAULT_STATE, EPHERMAL_KEY } from "@/controllers/TorusController";
import { i18n } from "@/plugins/i18nPlugin";
import installStorePlugin from "@/plugins/persistPlugin";
import { WALLET_SUPPORTED_NETWORKS } from "@/utils/const";
import { CONTROLLER_MODULE_KEY, LOCAL_STORAGE_KEY, TorusControllerState } from "@/utils/enums";
import { delay, isMain } from "@/utils/helpers";
import { NAVBAR_MESSAGES } from "@/utils/messages";
import { isWhiteLabelDark, isWhiteLabelSet } from "@/utils/whitelabel";

import store from "../store";
import { addToast } from "./app";

@Module({
  name: CONTROLLER_MODULE_KEY,
  namespaced: true,
  dynamic: true,
  store,
})
class ControllerModule extends VuexModule {
  public torus = new TorusController({
    _config: DEFAULT_CONFIG,
    _state: cloneDeep(DEFAULT_STATE),
  });

  public torusState: TorusControllerState = cloneDeep(DEFAULT_STATE);

  public instanceId = "";

  public logoutRequired = false;

  get selectedAddress(): string {
    return this.torusState.PreferencesControllerState?.selectedAddress || "";
  }

  get allAddresses(): string[] {
    return this.torusState.KeyringControllerState.wallets.map((x) => x.publicKey);
  }

  get allBalances() {
    return this.torusState.AccountTrackerState.accounts;
  }

  get selectedAccountPreferences(): ExtendedAddressPreferences {
    const preferences = this.torus.getAccountPreferences(this.selectedAddress);
    return (
      preferences || {
        ...DEFAULT_PREFERENCES,
        incomingBackendTransactions: [],
        displayActivities: {},
        network_selected: "testnet",
        theme: "dark",
      }
    );
  }

  get crashReport(): boolean {
    return this.selectedAccountPreferences.crashReport || false;
  }

  get selectedNetworkTransactions(): SolanaTransactionActivity[] {
    const txns = Object.values(this.selectedAccountPreferences.displayActivities || {});
    return txns.map((item) => {
      if (item.mintAddress) {
        if (item.decimal === 0) {
          const nftInfo = this.torusState.TokenInfoState.metaplexMetaMap[item.mintAddress];
          if (nftInfo) {
            return {
              ...item,
              logoURI: nftInfo.offChainMetaData?.image,
              cryptoCurrency: nftInfo.symbol,
            };
          }
        } else {
          const tokenInfo = this.torusState.TokenInfoState.tokenInfoMap[item.mintAddress];
          if (tokenInfo) {
            return {
              ...item,
              logoURI: tokenInfo.logoURI,
              cryptoCurrency: tokenInfo.symbol,
            };
          }
        }
        return {
          ...item,
          cryptoCurrency: addressSlicer(item.mintAddress),
        };
      }
      return item;
    });
  }

  get solBalance(): BigNumber {
    const lamports = new BigNumber(
      this.torusState.AccountTrackerState.accounts[this.torusState.PreferencesControllerState.selectedAddress]?.balance || 0
    );
    return lamports.div(LAMPORTS_PER_SOL);
  }

  get conversionRate(): number {
    return this.torus.conversionRate;
  }

  get currentCurrency(): string {
    return this.torus.currentCurrency;
  }

  get lastTokenRefreshDate(): Date {
    return this.torus.lastTokenRefreshDate;
  }

  get isNFTloading(): LoadingState {
    return this.torusState.TokenInfoState.metaplexLoadingState || LoadingState.LOADED;
  }

  get isSplTokenLoading(): LoadingState {
    return this.torusState.TokenInfoState.tokenInfoLoadingState || LoadingState.LOADED;
  }

  get isCurrencyRateUpdate(): LoadingState {
    return this.torusState.CurrencyControllerState.loadState || LoadingState.LOADED;
  }

  get totalBalance(): string {
    let balance = new BigNumber(0);
    const selectedCurrency = this.torusState.CurrencyControllerState.currentCurrency;
    balance = balance.plus(
      this.fungibleTokens.reduce((sum, curr) => {
        return sum.plus(new BigNumber((curr.balance?.uiAmount ?? 0) * (curr?.price?.[selectedCurrency.toLowerCase()] ?? 0)));
      }, new BigNumber(0))
    );
    // const pricePerToken = this.torusState.CurrencyControllerState.conversionRate;
    const pricePerToken = this.conversionRate;
    balance = balance.plus(this.solBalance.times(new BigNumber(pricePerToken)));
    return balance.toFixed(selectedCurrency.toLowerCase() === "sol" ? 4 : 2).toString();
  }

  // user balance in equivalent selected currency
  get convertedSolBalance(): string {
    const pricePerToken = this.conversionRate;
    const selectedCurrency = this.torusState.CurrencyControllerState.currentCurrency;
    const value = this.solBalance.times(new BigNumber(pricePerToken));
    return value.toFixed(selectedCurrency.toLowerCase() === "sol" ? 4 : 2).toString(); // SOL should be 4 decimal places
  }

  // get selectedBalance(): string {}

  get selectedNetworkDisplayName(): string {
    return this.torusState.NetworkControllerState.network;
  }

  get contacts(): Contact[] {
    return [...this.selectedAccountPreferences.contacts];
  }

  get isDarkMode(): boolean {
    if (isWhiteLabelSet() && !this.torus.getAccountPreferences(this.selectedAddress)) return isWhiteLabelDark();
    return this.selectedAccountPreferences.theme === "dark";
  }

  get userTokens(): SolanaToken[] {
    return this.torus.state.TokensTrackerState.tokens ? this.torus.state.TokensTrackerState.tokens[this.selectedAddress] : [];
  }

  get nonFungibleTokens(): SolanaToken[] {
    if (this.userTokens)
      return this.userTokens
        .reduce((acc: SolanaToken[], current: SolanaToken) => {
          if (
            !(current.balance?.decimals === 0) ||
            !(current.balance.uiAmount > 0) ||
            !this.torusState.TokenInfoState.metaplexMetaMap[current.mintAddress]?.uri
          ) {
            return acc;
          }
          return [
            ...acc,
            {
              ...current,
              metaplexData: this.torusState.TokenInfoState.metaplexMetaMap[current.mintAddress],
            },
          ];
        }, [])
        .sort((a: SolanaToken, b: SolanaToken) => a.tokenAddress.localeCompare(b.tokenAddress));
    return [];
  }

  get fungibleTokens(): SolanaToken[] {
    if (this.userTokens)
      return this.userTokens
        .reduce((acc: SolanaToken[], current: SolanaToken) => {
          const data = this.torusState.TokenInfoState.tokenInfoMap[current.mintAddress];
          if (data?.address === "So11111111111111111111111111111111111111112") (data as any).symbol = "WSOL";
          if (current.balance?.decimals !== 0 && current.balance?.uiAmount && data) {
            return [
              ...acc,
              {
                ...current,
                data,
                price: this.torusState.CurrencyControllerState.tokenPriceMap[current.mintAddress] || {},
              },
            ];
          }
          return acc;
        }, [])
        .sort((a: SolanaToken, b: SolanaToken) => a.tokenAddress.localeCompare(b.tokenAddress));
    return [];
  }

  get connection() {
    return this.torus.connection;
  }

  get hasSelectedPrivateKey() {
    return this.torus.hasSelectedPrivateKey;
  }

  @Mutation
  public setLogoutRequired(status: boolean) {
    this.logoutRequired = status;
  }

  @Mutation
  public setInstanceId(instanceId: string) {
    this.instanceId = instanceId;
  }

  @Mutation
  public updateTorusState(state: TorusControllerState): void {
    this.torusState = { ...state };
  }

  @Mutation
  public resetTorusController(): void {
    this.torus = new TorusController({
      _config: DEFAULT_CONFIG,
      _state: cloneDeep(DEFAULT_STATE),
    });
  }

  @Action
  handleError(error: string): void {
    addToast({ type: "error", message: error });
  }

  @Action
  handleSuccess(message: string): void {
    addToast({ type: "success", message: message || "" });
  }

  @Action
  openWalletPopup(path: string) {
    this.torus.showWalletPopup(path, this.instanceId);
  }

  @Action
  public async setCrashReport(status: boolean): Promise<void> {
    const t = i18n.global.t as VueI18nTranslation;
    const isSet = await this.torus.setCrashReport(status);
    if (isSet) {
      if (storageAvailable("localStorage")) {
        localStorage.setItem("torus-enable-crash-reporter", String(status));
      }
      this.handleSuccess(t(NAVBAR_MESSAGES.success.CRASH_REPORT_SUCCESS));
    } else {
      this.handleError(t(NAVBAR_MESSAGES.error.CRASH_REPORT_FAILED));
    }
  }

  @Action
  public async refreshUserTokens() {
    await this.torus.refreshUserTokens();
  }

  @Action
  public async getNFTmetadata(mint_address: string): Promise<NFTInfo | undefined> {
    try {
      const { onChainMetadataMap } = await this.torus.fetchMetaPlexNft([mint_address]);
      return onChainMetadataMap[mint_address];
    } catch (error) {
      return undefined;
    }
  }

  @Action
  public async getSNSAddress({ type, address }: { type: string; address: string }): Promise<string | null> {
    let filtered_address;
    switch (type) {
      case "sns":
        filtered_address = address.replace(/\.sol$/, "");
        break;
      case "twitter":
        filtered_address = address.replace(/^@/, "");
        break;
      default:
        filtered_address = "";
    }
    try {
      const data = await this.torus.getSNSAccount(type, filtered_address);
      if (data instanceof PublicKey) return data.toBase58();
      if (data instanceof NameRegistryState) return data.owner.toBase58();
      return null;
    } catch (e) {
      return null;
    }
  }

  @Action
  public async addContact(contactPayload: ContactPayload): Promise<void> {
    const t = i18n.global.t as VueI18nTranslation;
    // const { t } = useI18n({ useScope: "global" });
    const isDeleted = await this.torus.addContact(contactPayload);
    if (isDeleted) {
      this.handleSuccess(t(NAVBAR_MESSAGES.success.ADD_CONTACT_SUCCESS));
    } else {
      this.handleError(t(NAVBAR_MESSAGES.error.ADD_CONTACT_FAILED));
    }
  }

  @Action
  public async deleteContact(contactId: number): Promise<void> {
    const t = i18n.global.t as VueI18nTranslation;
    // const { t } = useI18n({ useScope: "global" });
    const isDeleted = await this.torus.deleteContact(contactId);
    if (isDeleted) {
      this.handleSuccess(t(NAVBAR_MESSAGES.success.DELETE_CONTACT_SUCCESS));
    } else {
      this.handleError(t(NAVBAR_MESSAGES.error.DELETE_CONTACT_FAILED));
    }
  }

  @Action
  public async changeTheme(theme: "light" | "dark") {
    const instanceId = new URLSearchParams(window.location.search).get("instanceId");
    if (instanceId) {
      const themeChannel = new BroadcastChannel<PopupData<ThemeChannelData>>(
        `${BROADCAST_CHANNELS.THEME_CHANGE}_${instanceId}`,
        broadcastChannelOptions
      );
      themeChannel.postMessage({
        data: {
          type: BROADCAST_CHANNELS_MSGS.SET_THEME,
          theme,
        },
      });
      themeChannel.close();
    }
    this.torus.setTheme(theme);
  }

  @Action
  public async setCurrency(currency: string): Promise<void> {
    const t = i18n.global.t as VueI18nTranslation;
    const isSet = await this.torus.setDefaultCurrency(currency);
    if (isSet) {
      this.handleSuccess(t(NAVBAR_MESSAGES.success.SET_CURRENCY_SUCCESS));
    } else {
      this.handleError(t(NAVBAR_MESSAGES.error.SET_CURRENCY_FAILED));
    }
  }

  @Action
  public async setLocale(locale: string): Promise<void> {
    const t = i18n.global.t as VueI18nTranslation;
    const isSet = await this.torus.setLocale(locale);
    if (isSet) {
      this.handleSuccess(t(NAVBAR_MESSAGES.success.SET_LOCALE_SUCCESS));
    } else {
      this.handleError(t(NAVBAR_MESSAGES.error.SET_LOCALE_FAILED));
    }
  }

  @Action
  public async getBillBoardData(): Promise<BillboardEvent[]> {
    return this.torus.getBillboardData();
  }

  @Action
  public toggleIframeFullScreen(): void {
    this.torus.toggleIframeFullScreen();
  }

  @Action
  public closeIframeFullScreen(): void {
    this.torus.closeIframeFullScreen();
  }

  /**
   * Call once on refresh
   */
  @Action
  public init({ state, origin }: { state?: Partial<TorusControllerState>; origin: string }): void {
    const instanceId = randomId();
    this.torus.init({
      _config: DEFAULT_CONFIG,
      _state: merge(this.torusState, state),
    });
    this.torus.setOrigin(origin);
    this.torus.setInstanceId(instanceId);
    this.torus.on("store", (_state: TorusControllerState) => {
      this.updateTorusState(_state);
    });
    // this.torus.setupUntrustedCommunication();
    // Good
    this.torus.on(TX_EVENTS.TX_UNAPPROVED, async ({ txMeta, req }) => {
      if (isMain) {
        this.torus.approveSignTransaction(txMeta.id);
      } else {
        await this.torus.handleTransactionPopup(txMeta.id, req);
      }
    });

    this.torus.on("logout", () => {
      // logoutWithBC();
      this.logout();
    });
    this.setInstanceId(instanceId);

    if (!isMain) {
      const popupStoreChannel = new PopupStoreChannel({
        instanceId: this.instanceId,
        handleLogout: this.handleLogoutChannelMsg.bind(this),
        handleAccountImport: this.importExternalAccount.bind(this),
        handleNetworkChange: (providerConfig: ProviderConfig) => this.setNetwork(providerConfig.chainId),
        handleSelectedAddressChange: this.setSelectedAccount.bind(this),
        handleThemeChange: this.changeTheme.bind(this),
      });
      popupStoreChannel.setupStoreChannels();
    }
  }

  @Action
  public setupCommunication(origin: string): void {
    log.info("setting up communication with", origin);
    const torusStream = new BasePostMessageStream({
      name: "iframe_torus",
      target: "embed_torus",
      targetWindow: window.parent,
    });

    const communicationStream = new BasePostMessageStream({
      name: "iframe_communication",
      target: "embed_communication",
      targetWindow: window.parent,
    });
    this.torus.setupUnTrustedCommunication(torusStream, origin);
    this.torus.setupCommunicationChannel(communicationStream, origin);
  }

  @Action
  async triggerLogin({
    loginProvider,
    login_hint,
    waitSaving,
  }: {
    loginProvider: LOGIN_PROVIDER_TYPE;
    login_hint?: string;
    waitSaving?: boolean;
  }): Promise<void> {
    this.setLogoutRequired(false);
    // do not need to restore beyond login
    await this.torus.triggerLogin({ loginProvider, login_hint, waitSaving });
  }

  @Action
  handleLogoutChannelMsg(): void {
    this.torus.handleLogout();
  }

  @Action
  async openloginLogout() {
    try {
      const openLoginInstance = await OpenLoginFactory.getInstance();
      // if (openLoginInstance.state.support3PC) {

      await openLoginInstance.logout();
    } catch (error) {
      log.warn(error, "unable to logout with openlogin");
    }
  }

  @Action
  async logout(): Promise<void> {
    if (isMain && this.selectedAddress) {
      this.openloginLogout();
    }
    const initialState = { ...cloneDeep(DEFAULT_STATE) };
    // this.updateTorusState(initialState);

    const { origin } = this.torus;
    if (isMain) {
      this.torus.init({ _config: cloneDeep(DEFAULT_CONFIG), _state: initialState });
    } else {
      // prevent network state reseted during logout due to failed restoration
      this.torus.init({
        _config: cloneDeep(DEFAULT_CONFIG),
        _state: { ...initialState, NetworkControllerState: cloneDeep(this.torusState.NetworkControllerState) },
      });
    }

    this.torus.setOrigin(origin);
    const instanceId = new URLSearchParams(window.location.search).get("instanceId");
    if (instanceId) {
      const logoutChannel = new BroadcastChannel<PopupData<BasePopupChannelData>>(
        `${BROADCAST_CHANNELS.WALLET_LOGOUT_CHANNEL}_${instanceId}`,
        broadcastChannelOptions
      );
      logoutChannel.postMessage({
        data: {
          type: BROADCAST_CHANNELS_MSGS.LOGOUT,
        },
      });
      logoutChannel.close();
    }

    try {
      window.localStorage?.removeItem(`${EPHERMAL_KEY}`);
      window.sessionStorage?.removeItem(`${EPHERMAL_KEY}`);
    } catch (error) {
      log.error(new Error("LocalStorage unavailable"));
    }
  }

  @Action
  setNetwork(chainId: string): void {
    const providerConfig = Object.values(WALLET_SUPPORTED_NETWORKS).find((x) => x.chainId === chainId);
    if (!providerConfig) throw new Error(`Unsupported network: ${chainId}`);
    this.torus.setNetwork(providerConfig);
    const instanceId = new URLSearchParams(window.location.search).get("instanceId");
    if (instanceId) {
      const networkChangeChannel = new BroadcastChannel<PopupData<NetworkChangeChannelData>>(
        `${BROADCAST_CHANNELS.WALLET_NETWORK_CHANGE_CHANNEL}_${instanceId}`,
        broadcastChannelOptions
      );
      networkChangeChannel.postMessage({
        data: {
          type: BROADCAST_CHANNELS_MSGS.NETWORK_CHANGE,
          network: providerConfig,
        },
      });
      networkChangeChannel.close();
    }
  }

  @Action
  async importExternalAccount(privKey: string): Promise<void> {
    const paddedKey = privKey.padStart(64, "0");
    const address = await this.torus.importExternalAccount(paddedKey, this.torus.userInfo);
    this.torus.setSelectedAccount(address);
    const instanceId = new URLSearchParams(window.location.search).get("instanceId");
    if (instanceId) {
      const accountImportChannel = new BroadcastChannel<PopupData<AccountImportedChannelData>>(
        `${BROADCAST_CHANNELS.WALLET_ACCOUNT_IMPORT_CHANNEL}_${instanceId}`,
        broadcastChannelOptions
      );
      accountImportChannel.postMessage({
        data: {
          type: BROADCAST_CHANNELS_MSGS.ACCOUNT_IMPORTED,
          privKey: paddedKey,
        },
      });
      accountImportChannel.close();
    }
  }

  @Action
  async resolveKey({ key, strategy }: { key: string; strategy: string }): Promise<string> {
    switch (strategy) {
      case "PrivateKey":
        if (!key) throw new Error("Private Key Cannot Be Empty");
        return key;
      default:
        throw new Error("Invalid Import Strategy");
    }
  }

  @Action
  async setSelectedAccount(address: string) {
    this.torus.setSelectedAccount(address);
    const instanceId = new URLSearchParams(window.location.search).get("instanceId");
    if (instanceId) {
      const selectedAddressChannel = new BroadcastChannel<PopupData<SelectedAddresssChangeChannelData>>(
        `${BROADCAST_CHANNELS.WALLET_SELECTED_ADDRESS_CHANNEL}_${instanceId}`,
        broadcastChannelOptions
      );
      selectedAddressChannel.postMessage({
        data: {
          type: BROADCAST_CHANNELS_MSGS.SELECTED_ADDRESS_CHANGE,
          selectedAddress: address,
        },
      });
      selectedAddressChannel.close();
    }
  }

  @Action
  async handleRedirectFlow({ method, params, resolveRoute }: { method: string; params: { [keyof: string]: any }; resolveRoute: string }) {
    let res;
    switch (method) {
      case "topup":
        await this.torus.handleTopup(
          params.provider,
          params.params ? params.params : { selectedAddress: this.selectedAddress },
          undefined,
          true,
          resolveRoute as string
        );
        break;
      case "wallet_instance_id":
        res = { wallet_instance_id: "" };
        break;
      case "get_provider_state":
        res = {
          currentLoginProvider: this.torus.getAccountPreferences(this.selectedAddress)?.userInfo.typeOfLogin || "",
          isLoggedIn: !!this.selectedAddress,
        };
        break;
      case "wallet_get_provider_state":
        res = {
          accounts: this.torus.state.KeyringControllerState.wallets.map((e) => e.publicKey),
          chainId: this.torus.state.NetworkControllerState.chainId,
          isUnlocked: !!this.selectedAddress,
        };
        break;
      case "user_info":
        res = this.torus.userInfo;
        break;
      case "get_gasless_public_key":
        res = { pubkey: await this.torus.getGaslessPublicKey() };
        break;
      case "get_accounts":
        // res = this.selectedAddress ? Object.keys(this.torus.state.PreferencesControllerState.identities) : [];
        res = [this.selectedAddress];
        break;
      case "solana_request_accounts":
        // res = this.selectedAddress ? Object.keys(this.torus.state.PreferencesControllerState.identities) : [];
        res = [this.selectedAddress];
        break;
      case "nft_list":
        await delay(15000);
        res =
          this.nonFungibleTokens?.map((token: SolanaToken) => {
            return { balance: token.balance, mint: token.mintAddress, name: token.metaplexData?.name, uri: token.metaplexData?.uri };
          }) || [];
        break;
      default:
    }
    return res;
  }

  @Action
  async getDappList(): Promise<DiscoverDapp[]> {
    return this.torus.getDappList();
  }
}

const moduleName = `${CONTROLLER_MODULE_KEY}`;
installStorePlugin({
  key: moduleName,
  storage: LOCAL_STORAGE_KEY,
  saveState: (key: string, state: Record<string, unknown>, storage?: Storage) => {
    const requiredState = omit(state, [`${moduleName}.torus`, `${moduleName}.logoutRequired`, `${moduleName}.torusState.KeyringControllerState`]);
    storage?.setItem(key, JSON.stringify(requiredState));
  },
  restoreState: (key: string, storage?: Storage) => {
    const value = storage?.getItem(key);
    if (typeof value === "string") {
      // If string, parse, or else, just return
      const parsedValue = JSON.parse(value || "{}");
      return {
        [moduleName]: {
          torus: new TorusController({ _config: cloneDeep(DEFAULT_CONFIG), _state: cloneDeep(DEFAULT_STATE) }),
          ...(parsedValue[moduleName] || {}),
        },
      };
    }
    return value || {};
  },
});

const module1 = getModule(ControllerModule);
export default module1;
