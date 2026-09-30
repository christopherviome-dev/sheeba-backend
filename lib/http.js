// How browsers may talk to the server. The app (Netlify) and the server (Render)
// live at different addresses, so browsers first ask permission ("preflight")
// before most requests. maxAge tells them to REMEMBER the answer (2 hours is the
// most Chrome allows); without it they forget after ~5 seconds and ask again,
// so most taps made two trips across the sea instead of one.
module.exports.corsOptions = { maxAge: 7200 };
