// api = the Google Apps Script /exec URL of the team server; appUrl = this app's public link.
// firebase + vapidKey = the Firebase web app settings (public values, safe here) for phone pop-ups when the app is closed.
// Uses `self` so the service worker can read it too.
self.RCAL_CONFIG = {
  api: 'https://script.google.com/macros/s/AKfycbxNFMDYdHCtNvvK8w99FdPaStvhqU0Lb8Zi-qmQH0XwXarXZ-3UmAu75GODSoswU80/exec',
  appUrl: 'https://wkahjian93.github.io/redefine-calendar/',
  firebase: {
    apiKey: 'AIzaSyAgImD0Ymcz2xxJqxrLAY4pWKPq5LU_s80',
    authDomain: 'redefine-calendar.firebaseapp.com',
    projectId: 'redefine-calendar',
    storageBucket: 'redefine-calendar.firebasestorage.app',
    messagingSenderId: '6378826198',
    appId: '1:6378826198:web:6eb6e904b430037d715c77'
  },
  vapidKey: 'BDXnbHzWr_2YQdgruNn_zrQCejdefoXDHC3dSL0r52uT32tdxk3zryUrm96NIo1vGbPhVEJjRJfcTMRK7J7PsCM'
};
