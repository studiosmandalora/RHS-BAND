-- Fix event types based on event names

-- Performance events
UPDATE events SET type = 'performance', event_type = 'Performance' WHERE name ILIKE '%Performance%' AND google_calendar_uid IS NOT NULL;
UPDATE events SET type = 'performance', event_type = 'Performance' WHERE name ILIKE '%Parade%' AND google_calendar_uid IS NOT NULL;
UPDATE events SET type = 'performance', event_type = 'Performance' WHERE name ILIKE '%Gig%' AND google_calendar_uid IS NOT NULL;
UPDATE events SET type = 'performance', event_type = 'Performance' WHERE name ILIKE '%Jam%' AND name NOT ILIKE '%Drumline%' AND google_calendar_uid IS NOT NULL;

-- Concert events
UPDATE events SET type = 'concert', event_type = 'Concert' WHERE name ILIKE '%Concert%' AND google_calendar_uid IS NOT NULL;
UPDATE events SET type = 'concert', event_type = 'Concert' WHERE name ILIKE '%Festival%' AND name NOT ILIKE '%Audition%' AND google_calendar_uid IS NOT NULL;

-- Game events
UPDATE events SET type = 'game', event_type = 'Game' WHERE name ILIKE '%Football Game%' AND google_calendar_uid IS NOT NULL;

-- Audition events
UPDATE events SET type = 'audition', event_type = 'Audition' WHERE name ILIKE '%Audition%' AND google_calendar_uid IS NOT NULL;

-- Meeting events
UPDATE events SET type = 'band meeting', event_type = 'Band Meeting' WHERE name ILIKE '%Leadership Training%' AND google_calendar_uid IS NOT NULL;
UPDATE events SET type = 'parent meeting', event_type = 'Parent Meeting' WHERE name ILIKE '%Booster%' AND google_calendar_uid IS NOT NULL;

-- Event/Activity
UPDATE events SET type = 'event/activity', event_type = 'Event/Activity' WHERE name ILIKE '%Watch Party%' AND google_calendar_uid IS NOT NULL;
UPDATE events SET type = 'event/activity', event_type = 'Event/Activity' WHERE name ILIKE '%Camp%' AND name NOT ILIKE '%Drumline%' AND name NOT ILIKE '%Rehearsal%' AND google_calendar_uid IS NOT NULL;
UPDATE events SET type = 'event/activity', event_type = 'Event/Activity' WHERE name ILIKE '%First Day%' AND google_calendar_uid IS NOT NULL;
UPDATE events SET type = 'event/activity', event_type = 'Event/Activity' WHERE name ILIKE '%NO SCHOOL%' AND google_calendar_uid IS NOT NULL;

-- Workshop
UPDATE events SET type = 'workshop', event_type = 'Workshop' WHERE name ILIKE '%Training%Drumline%' AND google_calendar_uid IS NOT NULL;

-- Also fix the manually-created demo events
UPDATE events SET event_type = 'Rehearsal' WHERE name ILIKE '%Rehearsal%' AND google_calendar_uid IS NULL;
UPDATE events SET type = 'game', event_type = 'Game' WHERE name ILIKE '%Exhibition%' AND google_calendar_uid IS NULL;
UPDATE events SET type = 'game', event_type = 'Game' WHERE name ILIKE '%Opener%' AND google_calendar_uid IS NULL;
UPDATE events SET type = 'game', event_type = 'Game' WHERE name ILIKE '%Away%' AND google_calendar_uid IS NULL;
UPDATE events SET type = 'concert', event_type = 'Concert' WHERE name ILIKE '%Concert%' AND google_calendar_uid IS NULL;
