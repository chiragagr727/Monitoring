/* App bootstrap. */
function requireAuth(handler) {
  return (params) => {
    if (!API.getToken()) {
      location.hash = '#/login';
      return;
    }
    handler(params);
  };
}

Router.on('/login',          () => LoginView.render('login'));
Router.on('/register',       () => LoginView.render('register'));
Router.on('/',               requireAuth(() => Dashboard.render()));
Router.on('/add',            requireAuth(() => AddHost.render()));
Router.on('/host/:id',       requireAuth((p) => HostDetail.render(p)));
Router.on('/alerts',         requireAuth(() => Alerts.render()));

// Boot
if (!location.hash) location.hash = API.getToken() ? '#/' : '#/login';
Router.resolve();
