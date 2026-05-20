function auth(fn) {
  return params => {
    if (!API.getToken()) { location.hash = '#/login'; return; }
    fn(params);
  };
}

Router.on('/login',    ()  => LoginView.render('login'));
Router.on('/register', ()  => LoginView.render('register'));
Router.on('/',         auth(() => Dashboard.render()));
Router.on('/add',      auth(() => AddHost.render()));
Router.on('/alerts',   auth(() => AlertsView.render()));
Router.on('/host/:id', auth(p  => HostDetail.render(p)));

if (!location.hash || location.hash === '#') {
  location.hash = API.getToken() ? '#/' : '#/login';
} else {
  Router.resolve();
}
