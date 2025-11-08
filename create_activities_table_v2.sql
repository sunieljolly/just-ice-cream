DROP TABLE IF EXISTS public.activities;

CREATE TABLE public.activities (
    id BIGINT PRIMARY KEY,
    athlete_id BIGINT,
    athlete_name TEXT,
    name TEXT,
    distance DOUBLE PRECISION,
    elapsed_time INTEGER,
    start_date TIMESTAMP WITHOUT TIME ZONE,
    activity_type TEXT,
    elevation_gain DOUBLE PRECISION,
    average_heartrate DOUBLE PRECISION,
    total_photo_count INTEGER
);