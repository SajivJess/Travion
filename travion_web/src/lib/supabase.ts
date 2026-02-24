import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://isjiipizrkukwlneoqzf.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzamlpcGl6cmt1a3dsbmVvcXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MTUwNTAsImV4cCI6MjA4NzM5MTA1MH0.BmU4uG0Sbf7sj5_7m91jpmwK-X_HfcCNDi4U4UsGR1o';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
