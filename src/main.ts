import "@/main.css";

import log from "loglevel";
import { createApp } from "vue";
import VueGtag from "vue-gtag";

import App from "@/App.vue";
import { googleAnalyticsDirective } from "@/directives/google-analytics";
import router from "@/router";
import { applyWhiteLabelColors, setWhiteLabel } from "@/utils/whitelabel";

import { i18n } from "./plugins/i18nPlugin";
import * as serviceWorker from "./registerServiceWorker";
import { installSentry } from "./sentry";
import store from "./store";

const { VUE_APP_GA_ID } = process.env;

const vue = createApp(App);
vue
  .use(i18n)
  .use(router)
  .use(store)
  .use(VueGtag, {
    config: { id: VUE_APP_GA_ID },
  })
  .mount("#app");
const whiteLabelDetails = {
  defaultLanguage: "ja", // default english
  logoDark: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png", // default solana logo
  logoLight: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png", // default solana logo
  name: "fork solana", // wallet name
  theme: { isDark: true, colors: { torusBrand1: "#2dffb2" } }, // default theme dark, default color: #9945ff
};
setWhiteLabel(whiteLabelDetails);
applyWhiteLabelColors();
installSentry(vue);
serviceWorker.register({
  onUpdate: (registration) => {
    const waitingServiceWorker = registration.waiting;

    if (waitingServiceWorker) {
      waitingServiceWorker.addEventListener("statechange", (event: Event) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (event?.target?.state === "activated") {
          window.location.reload();
        }
      });
      log.info("skipping waiting on register");
      waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
    }
  },
});

// DIRECTIVES
vue.directive("ga", googleAnalyticsDirective);
