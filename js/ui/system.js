function renderSystem(sys) {
  if (!sys || !sys.hostname) return;
  document.title = 'Dashboard \u2014 ' + sys.hostname;
}

export { renderSystem };
