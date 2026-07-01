import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import "./ui/factorio.css";

createApp(App).use(createPinia()).mount("#app");
