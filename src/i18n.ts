/**
 * Minimal internationalization (i18n) layer.
 * Currently supports Russian strings with key fallback.
 */
export const translations: Record<string, string> = {
  'menu.playLocal': 'Играть локально',
  'menu.playBot': 'Играть с ботом',
  'menu.playOnline': 'Играть по сети',
  'menu.playVariants': 'Играть в вариации',
  'menu.analysis': 'Анализ',
  'common.soon': 'Скоро',
  'common.themeToggleDark': 'Тёмная тема',
  'common.themeToggleLight': 'Светлая тема',
  'header.backToMain': 'На главный',
  'game.leaveConfirm': 'Партия будет потеряна',
  'history.title': 'Архив партий',
  'history.intro': 'Ваши последние 100 партий и библиотека PGN',
  'history.back': '← В главное меню',
  'history.all': 'Все',
  'history.wins': 'Победы',
  'history.losses': 'Поражения',
  'history.draws': 'Ничьи',
  'history.win': 'Победа',
  'history.loss': 'Поражение',
  'history.draw': 'Ничья',
  'history.empty': 'Пока нет завершённых партий. Сыграйте с ботом или другом!',
  'history.noMatches': 'Нет партий с таким результатом.',
  'history.review': 'Разбор',
  'history.reviewTitle': 'Разбор партии',
  'history.closeReview': 'Закрыть разбор',
  'history.delete': 'Удалить',
  'history.copied': 'PGN скопирован',
  'history.copyError': 'Не удалось скопировать PGN',
  'history.loadError': 'Не удалось загрузить PGN партии',
  'history.white': 'Белые',
  'history.black': 'Чёрные',
  'history.moves': 'Ходов',
  'history.accuracy': 'Точность',
  'history.overview': 'Обзор',
  'history.graph': 'График',
  'history.moveList': 'Ходы',
  'history.checkmate': 'Мат',
  'history.timeout': 'Время истекло',
  'history.resignation': 'Сдача',
  'history.threefold': 'Троекратное повторение',
  'history.stalemate': 'Пат',
  'history.fiftyMoveRule': 'Правило 50 ходов',
  'history.insufficientMaterial': 'Недостаточно материала',
};

export function t(key: string): string {
  return translations[key] ?? key;
}

