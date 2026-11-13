-- Migration 7/7: reference data required in EVERY environment (not demo data).
-- Keep in sync with OPPORTUNITY_TYPES (src/types/opportunity.ts) and CITIES (src/lib/opportunities/cities.ts);
-- a test fails if they drift.

insert into public.categories (code, sort_order) values
  ('scholarship', 10), ('internship', 20), ('grant', 30), ('admission', 40), ('exchange', 50), ('training', 60),
  ('certification', 70), ('summer_school', 80), ('hackathon', 90), ('competition', 100), ('research', 110), ('other', 120)
on conflict (code) do nothing;

insert into public.cities (id, country, name_az, name_ru, name_en, sort_order) values
  ('baku',        'AZ', 'Bakı',       'Баку',       'Baku',        10),
  ('sumgait',     'AZ', 'Sumqayıt',   'Сумгаит',    'Sumgait',     20),
  ('ganja',       'AZ', 'Gəncə',      'Гянджа',     'Ganja',       30),
  ('mingachevir', 'AZ', 'Mingəçevir', 'Мингечевир', 'Mingachevir', 40),
  ('shirvan',     'AZ', 'Şirvan',     'Ширван',     'Shirvan',     50),
  ('lankaran',    'AZ', 'Lənkəran',   'Ленкорань',  'Lankaran',    60),
  ('shaki',       'AZ', 'Şəki',       'Шеки',       'Shaki',       70),
  ('nakhchivan',  'AZ', 'Naxçıvan',   'Нахичевань', 'Nakhchivan',  80),
  ('berlin',      'DE', 'Berlin',     'Берлин',     'Berlin',      90),
  ('zurich',      'CH', 'Sürix',      'Цюрих',      'Zurich',     100),
  ('cambridge-gb','GB', 'Kembric',    'Кембридж',   'Cambridge',  110),
  ('istanbul',    'TR', 'İstanbul',   'Стамбул',    'Istanbul',   120),
  ('amsterdam',   'NL', 'Amsterdam',  'Амстердам',  'Amsterdam',  130),
  ('boston',      'US', 'Boston',     'Бостон',     'Boston',     140)
on conflict (id) do nothing;
