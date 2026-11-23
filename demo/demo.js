// Demo page texts in English and Russian. ?lang=ru or ?lang=en overrides the browser language.
(function () {
  var TEXTS = {
    en: {
      banner: 'Safe demo by ScamFuse. Nothing on these pages can harm your computer.',
      title: 'Try a scam safely',
      lead: 'Each scenario imitates a real trick. Install ScamFuse first, then open one and watch it stop.',
      install: 'Install ScamFuse',
      clickfix_title: 'Fake “I am not a robot” check',
      clickfix_text: 'The site secretly copies a command and asks you to paste it into Windows.',
      alert_title: 'Fake virus alert',
      alert_text: 'A page pretends the computer is infected and asks you to call “support”.',
      phishing_title: 'Fake bank login',
      phishing_text: 'A copy of a bank page that says your account is blocked and asks for the password.',
      remote_title: 'Remote access program',
      remote_text: 'A “bank employee” asks you to install a program to “protect your account”.',
      program_title: 'Free game coins',
      program_text: 'A cheat that promises free coins. ScamFuse stops it in the child profile.',
      open: 'Open',
      download: 'Download (demo file)',
      tag_all: 'All profiles',
      tag_child: 'Child profile',
      steps_title: 'How to try',
      step1: 'Install ScamFuse and choose who it protects.',
      step2: 'Open a scenario. ScamFuse shows the pause screen instead of the trick.',
      step3: 'Press “Ask …” to see the message your trusted person would get.'
    },
    ru: {
      banner: 'Безопасная демонстрация ScamFuse. Ничто на этих страницах не навредит компьютеру.',
      title: 'Попробуйте обман безопасно',
      lead: 'Каждый сценарий повторяет настоящую уловку. Сначала установите ScamFuse, затем откройте сценарий и посмотрите, как он остановится.',
      install: 'Установить ScamFuse',
      clickfix_title: 'Поддельная проверка «Я не робот»',
      clickfix_text: 'Сайт тайно копирует команду и просит вставить её в Windows.',
      alert_title: 'Поддельная вирусная тревога',
      alert_text: 'Страница делает вид, что компьютер заражён, и просит позвонить в «поддержку».',
      phishing_title: 'Поддельный вход в банк',
      phishing_text: 'Копия страницы банка: пишет, что аккаунт заблокирован, и просит пароль.',
      remote_title: 'Программа удалённого доступа',
      remote_text: '«Сотрудник банка» просит поставить программу, чтобы «защитить счёт».',
      program_title: 'Бесплатные игровые монеты',
      program_text: 'Чит, который обещает бесплатные монеты. ScamFuse останавливает его в профиле ребёнка.',
      open: 'Открыть',
      download: 'Скачать (демо-файл)',
      tag_all: 'Все профили',
      tag_child: 'Профиль ребёнка',
      steps_title: 'Как попробовать',
      step1: 'Установите ScamFuse и выберите, кого он защищает.',
      step2: 'Откройте сценарий. Вместо уловки ScamFuse покажет экран паузы.',
      step3: 'Нажмите «Спросить …», чтобы увидеть сообщение, которое получит близкий.'
    }
  };

  function language() {
    var forced = new URLSearchParams(location.search).get('lang');
    if (forced && TEXTS[forced]) return forced;
    var browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return TEXTS[browser] ? browser : 'en';
  }

  var lang = language();
  window.SCAMFUSE_DEMO_LANG = lang;
  document.documentElement.lang = lang;
  var nodes = document.querySelectorAll('[data-t]');
  for (var i = 0; i < nodes.length; i += 1) {
    var key = nodes[i].getAttribute('data-t');
    if (TEXTS[lang][key]) nodes[i].textContent = TEXTS[lang][key];
  }
  var links = document.querySelectorAll('a[data-keep-lang]');
  for (var j = 0; j < links.length; j += 1) {
    var url = new URL(links[j].getAttribute('href'), location.href);
    url.searchParams.set('lang', lang);
    links[j].setAttribute('href', url.pathname.split('/').pop() + url.search);
  }
  // The demo downloads in files/ are short text files with program names. They do nothing if opened.
})();
