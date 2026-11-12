// api = the Google Apps Script /exec URL of the team server; appUrl = this app's public link.
// firebase + vapidKey = the Firebase web app settings (public values, safe here) for phone pop-ups when the app is closed.
// Filled in when the app goes live. Uses `self` so the service worker can read it too.
self.RCAL_CONFIG = {
  api: '',
  appUrl: '',
  firebase: null,
  vapidKey: ''
};
