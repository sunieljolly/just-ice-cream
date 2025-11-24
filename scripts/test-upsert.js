require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
  const unixExample = 1764002128; // problematic value from error message

  const profileNumeric = {
    id: 9999999999,
    firstname: 'Test',
    lastname: 'NumericExpires',
    profile_picture_url: null,
    expires_at: unixExample,
  };

  const profileISO = {
    ...profileNumeric,
    id: 9999999998,
    lastname: 'IsoExpires',
    expires_at: new Date(Number(unixExample) * 1000).toISOString(),
  };

  console.log('Upserting numeric expires_at (should trigger parse error if DB rejects numeric):');
  let result = await supabase.from('profiles').upsert(profileNumeric, { onConflict: 'id' }).select();
  console.log('Numeric upsert result:', JSON.stringify(result, null, 2));

  console.log('\nUpserting ISO expires_at (should succeed):');
  result = await supabase.from('profiles').upsert(profileISO, { onConflict: 'id' }).select();
  console.log('ISO upsert result:', JSON.stringify(result, null, 2));
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
