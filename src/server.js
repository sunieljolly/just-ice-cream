require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

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
        const response = await fetch('https://www.strava.com/oauth/token', {
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

        const data = await response.json();

        if (data.access_token) {
            const athleteName = `${data.athlete.firstname} ${data.athlete.lastname}`;
            res.redirect(`/?access_token=${data.access_token}&athlete_id=${data.athlete.id}&athlete_name=${encodeURIComponent(athleteName)}`);
        } else {
            res.status(400).send('Failed to get access token.');
        }
    } catch (error) {
        console.error('Error during Strava OAuth callback:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/activities', async (req, res) => {
    const { access_token, athlete_name } = req.query;

    if (!access_token) {
        return res.status(401).send('Access token is missing.');
    }

    try {
        const { data: mostRecentEntry, error: recentEntryError } = await supabase
            .from('activities')
            .select('start_date')
            .order('start_date', { ascending: false })
            .limit(1);

        if (recentEntryError) {
            console.error('Error fetching most recent entry:', recentEntryError);
        }

        const after = mostRecentEntry && mostRecentEntry.length > 0 ? Math.floor(new Date(mostRecentEntry[0].start_date).getTime() / 1000) : null;

        const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?access_token=${access_token}${after ? `&after=${after}` : ''}`, {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });

        const activities = await response.json();
        let uploadedCount = 0;

        if (activities.length > 0) {
            const activitiesToInsert = activities.map(activity => ({
                id: activity.id,
                athlete_id: activity.athlete.id,
                athlete_name: athlete_name,
                name: activity.name,
                distance: activity.distance,
                elapsed_time: activity.elapsed_time,
                start_date: activity.start_date,
                activity_type: activity.type,
                elevation_gain: activity.total_elevation_gain,
                average_heartrate: activity.average_heartrate || null, // Strava might not always provide heart rate
                total_photo_count: activity.total_photo_count || 0,
            }));

            let result;
            if (typeof supabase.from('activities').insert([]).onConflict === 'function') { // Check if onConflict is available
                result = await supabase.from('activities').insert(activitiesToInsert).onConflict('id').doNothing().select('id'); // Select 'id' to get count
            } else {
                console.error('Error: onConflict is not a function. Falling back to manual conflict handling.');
                // Manual conflict handling: Select existing IDs and filter out activities that already exist
                const { data: existingActivities, error: selectError } = await supabase
                    .from('activities')
                    .select('id')
                    .in('id', activitiesToInsert.map(a => a.id));

                if (selectError) {
                    console.error('Error checking for existing activities:', selectError);
                    return res.status(500).json({ message: 'Failed to check for existing activities.', error: selectError.message });
                }

                const existingIds = new Set(existingActivities.map(a => a.id));
                const newActivitiesToInsert = activitiesToInsert.filter(a => !existingIds.has(a.id));

                if (newActivitiesToInsert.length > 0) {
                    result = await supabase.from('activities').insert(newActivitiesToInsert).select('id'); // Select 'id' to get count
                } else {
                    result = { data: [], error: null }; // No new activities to insert
                }
            }

            if (result.error) {
                console.error('Error inserting activities into Supabase:', result.error);
                return res.status(500).json({ message: 'Failed to store activities.', error: result.error.message });
            }
            uploadedCount = result.data ? result.data.length : 0;
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
            .select('id, athlete_name, name, distance, elapsed_time, start_date, activity_type, elevation_gain, average_heartrate, total_photo_count')
            .order('start_date', { ascending: false })
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

// Helper function to get the Monday of a given week (local time)
function getMondayOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 for Sunday, 1 for Monday, ..., 6 for Saturday
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust if day is Sunday
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0); // Set to start of the day (local time)
    return monday;
}

app.get('/api/weekly-leaderboard', async (req, res) => {
    try {
        const { data: allActivities, error } = await supabase
            .from('activities')
            .select('athlete_id, athlete_name, distance, elapsed_time, start_date, activity_type');

        if (error) {
            console.error('Error fetching all activities for weekly leaderboard:', error);
            return res.status(500).send('Failed to fetch activities for weekly leaderboard.');
        }

        const weeklyLeaderboard = {};

        allActivities.forEach(activity => {
            const activityDate = new Date(activity.start_date);
            const mondayOfWeek = getMondayOfWeek(activityDate);
            // Use toLocaleDateString to get a consistent string representation of the local Monday
            const weekString = mondayOfWeek.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }); // YYYY-MM-DD format for consistent keys

            if (!weeklyLeaderboard[weekString]) {
                weeklyLeaderboard[weekString] = {};
            }

            if (!weeklyLeaderboard[weekString][activity.athlete_id]) {
                weeklyLeaderboard[weekString][activity.athlete_id] = {
                    athlete_id: activity.athlete_id,
                    athlete_name: activity.athlete_name,
                    points: {
                        total: 0,
                        walk: 0,
                        run: 0,
                        football: 0,
                        other: 0,
                    },
                };
            }

            let pointsEarned = 0;
            let activityCategory = 'other';

            // 1 point for a walk over 45 mins or 3 km in distance.
            if (activity.activity_type && activity.activity_type.toLowerCase() === 'walk') {
                if (activity.elapsed_time > (45 * 60) || activity.distance > 3000) {
                    pointsEarned += 1;
                    activityCategory = 'walk';
                }
            }
            // 1 point for a run over 3 km.
            else if (activity.activity_type && activity.activity_type.toLowerCase() === 'run') {
                if (activity.distance > 3000) {
                    pointsEarned += 1;
                    activityCategory = 'run';
                }
            }
            // Any football activity.
            else if (activity.activity_type && activity.activity_type.toLowerCase().includes('football')) { // Assuming 'football' in type name
                pointsEarned += 1;
                activityCategory = 'football';
            }
            // Any other activity if it is over 30 mins
            else if (activity.elapsed_time > (30 * 60)) {
                pointsEarned += 1;
                activityCategory = 'other';
            }
            
            weeklyLeaderboard[weekString][activity.athlete_id].points.total += pointsEarned;
            if (pointsEarned > 0) {
                weeklyLeaderboard[weekString][activity.athlete_id].points[activityCategory] += 1;
            }
        });

        // Convert to a more consumable format: array of weeks, each with an array of athletes
        const formattedLeaderboard = Object.keys(weeklyLeaderboard).sort((a, b) => new Date(b) - new Date(a)).map(weekString => {
            const athletes = Object.values(weeklyLeaderboard[weekString]).sort((a, b) => b.points.total - a.points.total);
            return {
                week: weekString,
                athletes: athletes,
            };
        });

        res.json(formattedLeaderboard);

    } catch (error) {
        console.error('Error generating weekly leaderboard:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
