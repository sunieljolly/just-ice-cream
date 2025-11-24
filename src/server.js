require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { zonedTimeToUtc, utcToZonedTime, format } = require('date-fns-tz');

const app = express();
const port = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.static('public'));
app.use(express.json());

const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${process.env.STRAVA_REDIRECT_URI}&approval_prompt=force&scope=read,activity:read_all`;

app.get('/auth/strava', (req, res) => {
    res.redirect(stravaAuthUrl);
});

app.get('/auth/strava/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('Authorization code is missing.');
    }

    try {
        // Exchange the authorization code for an access token
        const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: process.env.STRAVA_CLIENT_ID,
                client_secret: process.env.STRAVA_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
            }),
        });

        const tokenData = await tokenResponse.json();

        if (tokenData.access_token) {
            // Fetch the athlete's profile from Strava
            const athleteResponse = await fetch('https://www.strava.com/api/v3/athlete', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                },
            });
            const athleteData = await athleteResponse.json();

            // Prepare athlete data for upsert
            const athleteProfile = {
                id: athleteData.id,
                firstname: athleteData.firstname,
                lastname: athleteData.lastname,
                profile_picture_url: athleteData.profile,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: tokenData.expires_at,
                timezone: athleteData.timezone, // e.g. "(GMT-08:00) America/Los_Angeles"
            };

            // Upsert the athlete's profile into the 'profiles' table
            const { error } = await supabase.from('profiles').upsert(athleteProfile, { onConflict: 'id' });

            if (error) {
                console.error('Error upserting athlete profile:', error);
                return res.status(500).send('Failed to save athlete profile.');
            }

            const athleteName = `${athleteData.firstname} ${athleteData.lastname}`;
            res.redirect(`/?access_token=${tokenData.access_token}&athlete_id=${athleteData.id}&athlete_name=${encodeURIComponent(athleteName)}`);
        } else {
            res.status(400).send('Failed to get access token.');
        }
    } catch (error) {
        console.error('Error during Strava OAuth callback:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/activities', async (req, res) => {
    const { access_token } = req.query;

    if (!access_token) {
        return res.status(401).send('Access token is missing.');
    }

    try {
        // Fetch the athlete's profile from Strava to ensure we have their timezone
        const athleteResponse = await fetch('https://www.strava.com/api/v3/athlete', {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });
        const athleteData = await athleteResponse.json();

        if (!athleteData.id) {
            return res.status(401).send('Invalid access token.');
        }

        // Upsert the athlete's profile to ensure it's in our database
        const athleteProfile = {
            id: athleteData.id,
            firstname: athleteData.firstname,
            lastname: athleteData.lastname,
            profile_picture_url: athleteData.profile,
            timezone: athleteData.timezone,
        };
        const { error: upsertError } = await supabase.from('profiles').upsert(athleteProfile, { onConflict: 'id' });

        if (upsertError) {
            console.error('Error upserting athlete profile during activity fetch:', upsertError);
            // We can continue without this, but timezone features might not work for this user
        }

        // Fetch the last 30 activities
        const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?access_token=${access_token}&page=1&per_page=30`, {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });

        const activities = await response.json();
        let uploadedCount = 0;

        if (activities.length > 0) {
            const athlete_name = `${athleteData.firstname} ${athleteData.lastname}`;
            const activitiesToInsert = activities.map(activity => {
                return {
                    id: activity.id,
                    athlete_id: activity.athlete.id,
                    athlete_name: athlete_name,
                    name: activity.name,
                    distance: activity.distance,
                    elapsed_time: activity.elapsed_time,
                    start_date_local: activity.start_date_local,
                    activity_type: activity.type,
                    elevation_gain: activity.total_elevation_gain,
                    average_heartrate: activity.average_heartrate || null,
                    total_photo_count: activity.total_photo_count || 0,
                };
            });

            const { data, error } = await supabase.from('activities').upsert(activitiesToInsert, { onConflict: 'id' }).select();

            if (error) {
                console.error('Error inserting activities into Supabase:', error);
                return res.status(500).json({ message: 'Failed to store activities.', error: error.message });
            }
            uploadedCount = data ? data.length : 0;
        }

        if (uploadedCount > 0) {
            res.json({ message: `Nice one - you just uploaded ${uploadedCount} activities!`, uploadedCount });
        } else {
            res.json({ message: 'Everything is up to date! No new activities found to upload.', uploadedCount: 0 });
        }
    } catch (error) {
        console.error('Error fetching activities from Strava:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data: activities, error } = await supabase
            .from('activities')
            .select('athlete_id, athlete_name, distance, elapsed_time');

        if (error) {
            console.error('Error fetching leaderboard data:', error);
            return res.status(500).send('Failed to fetch leaderboard data.');
        }

        const leaderboard = activities.reduce((acc, activity) => {
            const { athlete_id, athlete_name, distance, elapsed_time } = activity;
            if (!acc[athlete_id]) {
                acc[athlete_id] = {
                    athlete_id,
                    athlete_name,
                    activities: 0,
                    distance: 0,
                    elapsed_time: 0,
                };
            }
            acc[athlete_id].activities += 1;
            acc[athlete_id].distance += distance;
            acc[athlete_id].elapsed_time += elapsed_time;
            return acc;
        }, {});

        res.json(Object.values(leaderboard));
    } catch (error) {
        console.error('Error generating leaderboard:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/recent-activities', async (req, res) => {
    try {
        const { data: recentActivities, error } = await supabase
            .from('activities')
            .select('id, athlete_name, name, distance, elapsed_time, start_date_local, activity_type, elevation_gain, average_heartrate, total_photo_count')
            .order('start_date_local', { ascending: false })
            .limit(10); // Fetch the 10 most recent activities

        if (error) {
            console.error('Error fetching recent activities:', error);
            return res.status(500).send('Failed to fetch recent activities.');
        }

        res.json(recentActivities);
    } catch (error) {
        console.error('Error fetching recent activities:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Weekly Leaderboard
app.get('/weekly-leaderboard', async (req, res) => {
    try {
        // Helper function to get the start of the week (Monday) based on a local date
        const getStartOfWeek = (date) => {
            const d = new Date(date);
            const day = d.getDay(); // 0=Sun, 1=Mon, ...
            const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
            const monday = new Date(d.setDate(diff));
            monday.setHours(0, 0, 0, 0);
            return monday;
        };

        const weekQuery = req.query.week; // e.g., '2025-11-10'
        const targetDate = weekQuery ? new Date(weekQuery) : new Date();

        const startOfWeek = getStartOfWeek(targetDate);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 7);

        // Fetch activities from the last 9 days to be safe
        const nineDaysAgo = new Date();
        nineDaysAgo.setDate(nineDaysAgo.getDate() - 9);

        const { data: activities, error: activitiesError } = await supabase
            .from('activities')
            .select('*')
            .gte('start_date_local', nineDaysAgo.toISOString());

        if (activitiesError) throw activitiesError;

        // Fetch all profiles to get profile pictures
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, firstname, lastname, profile_picture_url');

        if (profilesError) throw profilesError;

        const profilesMap = profiles.reduce((acc, profile) => {
            acc[profile.id] = {
                name: `${profile.firstname} ${profile.lastname}`,
                profile_picture_url: profile.profile_picture_url,
            };
            return acc;
        }, {});

        const leaderboard = {};

        activities.forEach(activity => {
            if (!activity.start_date_local) {
                console.warn(`Activity ${activity.id} is missing start_date_local. Skipping.`);
                return;
            }

            const activityLocalDate = new Date(activity.start_date_local);

            if (activityLocalDate >= startOfWeek && activityLocalDate < endOfWeek) {
                const athleteId = activity.athlete_id;
                if (!leaderboard[athleteId]) {
                    leaderboard[athleteId] = {
                        athlete_id: athleteId,
                        athlete_name: profilesMap[athleteId] ? profilesMap[athleteId].name : activity.athlete_name,
                        profile_picture_url: profilesMap[athleteId] ? profilesMap[athleteId].profile_picture_url : null,
                        points: 0,
                        walk: 0,
                        run: 0,
                        soccer: 0,
                        weighttraining: 0,
                        other: 0,
                    };
                }

                let points = 0;
                if (activity.activity_type && activity.activity_type.toLowerCase() === 'walk') {
                    if (activity.elapsed_time > (45 * 60) || activity.distance > 3000) {
                        points += 1;
                        leaderboard[athleteId].walk += 1;
                    }
                }
                else if (activity.activity_type && activity.activity_type.toLowerCase() === 'run') {
                    if (activity.distance > 3000) {
                        points += 1;
                        leaderboard[athleteId].run += 1;
                    }
                }
                else if (activity.activity_type && activity.activity_type.toLowerCase().includes('soccer')) {
                    if (activity.elapsed_time > (30 * 60)){
                    points += 1;
                    leaderboard[athleteId].soccer += 1;
                    }

                }
                else if (activity.activity_type && activity.activity_type.toLowerCase().includes('weighttraining')) {
                    if (activity.elapsed_time > (30 * 60)){
                    points += 1;
                    leaderboard[athleteId].weighttraining += 1;
                    }

                }

                else if (activity.elapsed_time > (30 * 60)) {
                    points += 1;
                    leaderboard[athleteId].other += 1;
                }
                leaderboard[athleteId].points += points;
            }
        });

        const leaderboardValues = Object.values(leaderboard);

        const leaderboardWithSummary = leaderboardValues.map(athlete => {
            const summaryParts = [];
            if (athlete.walk > 0) summaryParts.push(`Walks: ${athlete.walk}`);
            if (athlete.run > 0) summaryParts.push(`Runs: ${athlete.run}`);
            if (athlete.soccer > 0) summaryParts.push(`Soccer: ${athlete.soccer}`);
            if (athlete.other > 0) summaryParts.push(`Other: ${athlete.other}`);
            if (athlete.weighttraining > 0) summaryParts.push(`Weight Training: ${athlete.weighttraining}`);
            
            return {
                athlete_name: athlete.athlete_name,
                profile_picture_url: athlete.profile_picture_url,
                points: athlete.points,
                summary: summaryParts.join(', ')
            };
        });

        const leaderboardArray = leaderboardWithSummary.sort((a, b) => b.points - a.points);

        res.json(leaderboardArray);
    } catch (error) {
        console.error('Error fetching weekly leaderboard data:', error);
        res.status(500).json({ error: 'Error fetching weekly leaderboard data' });
    }
});

app.get('/api/overall-leaderboard', async (req, res) => {
    try {
        const { data: activities, error: activitiesError } = await supabase
            .from('activities')
            .select('*');

        if (activitiesError) throw activitiesError;

        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, firstname, lastname, profile_picture_url');

        if (profilesError) throw profilesError;

        const profilesMap = profiles.reduce((acc, profile) => {
            acc[profile.id] = {
                name: `${profile.firstname} ${profile.lastname}`,
                profile_picture_url: profile.profile_picture_url,
            };
            return acc;
        }, {});

        const leaderboard = {};

        activities.forEach(activity => {
            const athleteId = activity.athlete_id;
            if (!leaderboard[athleteId]) {
                leaderboard[athleteId] = {
                    athlete_id: athleteId,
                    athlete_name: profilesMap[athleteId] ? profilesMap[athleteId].name : activity.athlete_name,
                    profile_picture_url: profilesMap[athleteId] ? profilesMap[athleteId].profile_picture_url : null,
                    total_walk_distance: 0,
                    total_walk_time: 0,
                    total_run_distance: 0,
                    total_run_time: 0,
                    total_weight_training_time: 0,
                    total_soccer_time: 0,
                    total_activities: 0,
                };
            }

            leaderboard[athleteId].total_activities += 1;

            if (activity.activity_type && activity.activity_type.toLowerCase() === 'walk') {
                leaderboard[athleteId].total_walk_distance += activity.distance;
                leaderboard[athleteId].total_walk_time += activity.elapsed_time;
            }
            else if (activity.activity_type && activity.activity_type.toLowerCase() === 'run') {
                leaderboard[athleteId].total_run_distance += activity.distance;
                leaderboard[athleteId].total_run_time += activity.elapsed_time;
            }
            else if (activity.activity_type && activity.activity_type.toLowerCase().includes('weighttraining')) {
                leaderboard[athleteId].total_weight_training_time += activity.elapsed_time;
            }
            else if (activity.activity_type && activity.activity_type.toLowerCase().includes('soccer')) {
                leaderboard[athleteId].total_soccer_time += activity.elapsed_time;
            }
        });

        res.json(Object.values(leaderboard));
    } catch (error) {
        console.error('Error fetching overall leaderboard data:', error);
        res.status(500).json({ error: 'Error fetching overall leaderboard data' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
