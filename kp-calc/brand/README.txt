CULTURA GROUP — фирменные файлы для нового проекта

fonts/    Prata 400 и Golos Text 400/500/600 (woff2, кириллица и латиница) + fonts.css с готовым подключением.
          Оба шрифта распространяются по лицензии SIL Open Font License — их можно свободно использовать и встраивать.
logo/     cultura-group-logo-white.svg — на тёмный фон; cultura-group-logo-gray.svg — серый #545452 на светлый.
          SVG сделаны трассировкой исходного PNG 2000 px (оригинального вектора в репозитории нет).
          Если у дизайнера есть исходник в AI/EPS/SVG — лучше взять его. Рядом лежат PNG с сайта (720 px).
texture/  stone.jpg — фактура «штукатурки» из фирменного квадрата.
          На сайте: background: #3b3b3a url(stone.jpg) center/cover; background-blend-mode: lighten;
          края растворяются маской-градиентом в цвет фона (#232322).
Цвета и правила — в DESIGN.md.

Примечание (kp-calc): из присланного набора в fonts/ не было Prata (кириллица и латиница) и Golos Text латиница 500/600.
Их взяли из npm-пакетов @fontsource/prata@5.2.5 и @fontsource/golos-text@5.2.5 (та же лицензия OFL, тексты лицензий рядом).
Остальные файлы Golos Text — присланные с сайта. texture/stone.jpg пока нет (картинка пришла в чат только как превью).
