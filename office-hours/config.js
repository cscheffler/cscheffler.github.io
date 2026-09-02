// config.js — the only file you need to edit.

// 1. Paste the web app config from the Firebase console here
//    (Project settings → Your apps → SDK setup and configuration → Config).
//    While apiKey still starts with "YOUR_", both pages run in demo mode.
export const firebaseConfig = {
  apiKey: "AIzaSyAdaNe02hTL-0S8yptoeqbwyPnjAFFzviU",
  authDomain: "office-plant-1.firebaseapp.com",
  projectId: "office-plant-1",
  storageBucket: "office-plant-1.firebasestorage.app",
  messagingSenderId: "19642607697",
  appId: "1:19642607697:web:8d38baa667818ad0a53070",
  databaseURL: "https://office-plant-1-default-rtdb.europe-west1.firebasedatabase.app"
};

// 2. Where the office is. The time zone drives the wall clock and the day/night cycle,
//    the coordinates drive sunrise and sunset, so every student sees the same sky
//    regardless of where they are. Default: Stirling, UK.
export const OFFICE_TIMEZONE = 'Europe/London';
export const OFFICE_LOCATION = { latitude: 56.12, longitude: -3.94 };

// 3. Show the real current weather at the office, from Open-Meteo (free, no key).
//    Set to false to use the built-in synthetic weather instead. The synthetic
//    weather is also the fallback whenever the live data cannot be fetched.
export const LIVE_WEATHER = true;

// 4. Seed for the synthetic weather and for the cloud drift. Change it to get a
//    different (but still shared and deterministic) history.
export const WEATHER_SEED = 42;
