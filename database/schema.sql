-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom types
CREATE TYPE user_role AS ENUM ('admin', 'organizer', 'voter');
CREATE TYPE organizer_status AS ENUM ('pending', 'approved', 'blocked');
CREATE TYPE event_status AS ENUM ('draft', 'active', 'ended');
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
CREATE TYPE payment_method AS ENUM ('stripe', 'paystack');

-- Users table (extends Supabase auth.users)
CREATE TABLE public.users (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    role user_role DEFAULT 'voter',
    organizer_status organizer_status DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Events table
CREATE TABLE public.events (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organizer_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    banner_image_url TEXT,
    vote_price DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    status event_status DEFAULT 'draft',
    total_votes INTEGER DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_dates CHECK (end_date > start_date),
    CONSTRAINT positive_vote_price CHECK (vote_price > 0)
);

-- Categories table (awards/elections)
CREATE TABLE public.categories (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(event_id, name)
);

-- Contestants table
CREATE TABLE public.contestants (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT,
    vote_count INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Votes table
CREATE TABLE public.votes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    voter_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    contestant_id UUID REFERENCES public.contestants(id) ON DELETE CASCADE NOT NULL,
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
    payment_id UUID UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(voter_id, contestant_id, payment_id)
);

-- Payments table
CREATE TABLE public.payments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    voter_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
    contestant_id UUID REFERENCES public.contestants(id) ON DELETE CASCADE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    platform_fee DECIMAL(10,2) NOT NULL,
    organizer_earnings DECIMAL(10,2) NOT NULL,
    payment_method payment_method NOT NULL,
    payment_provider_id VARCHAR(255), -- Stripe/Paystack transaction ID
    payment_intent_id VARCHAR(255),
    status payment_status DEFAULT 'pending',
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Platform settings table
CREATE TABLE public.platform_settings (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    commission_rate DECIMAL(5,4) DEFAULT 0.05,
    stripe_enabled BOOLEAN DEFAULT TRUE,
    paystack_enabled BOOLEAN DEFAULT TRUE,
    updated_by UUID REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Withdrawals table
CREATE TABLE public.withdrawals (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organizer_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    payment_details JSONB,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_events_organizer_id ON public.events(organizer_id);
CREATE INDEX idx_events_status ON public.events(status);
CREATE INDEX idx_events_dates ON public.events(start_date, end_date);
CREATE INDEX idx_categories_event_id ON public.categories(event_id);
CREATE INDEX idx_contestants_category_id ON public.contestants(category_id);
CREATE INDEX idx_votes_voter_id ON public.votes(voter_id);
CREATE INDEX idx_votes_contestant_id ON public.votes(contestant_id);
CREATE INDEX idx_votes_event_id ON public.votes(event_id);
CREATE INDEX idx_payments_voter_id ON public.payments(voter_id);
CREATE INDEX idx_payments_status ON public.payments(status);
CREATE INDEX idx_payments_created_at ON public.payments(created_at);

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- Users table policies
CREATE POLICY "Users can view their own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Anyone can view approved organizers" ON public.users
    FOR SELECT USING (role = 'organizer' AND organizer_status = 'approved');

CREATE POLICY "Admins can view all users" ON public.users
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Events table policies
CREATE POLICY "Anyone can view active events" ON public.events
    FOR SELECT USING (status = 'active');

CREATE POLICY "Organizers can view their own events" ON public.events
    FOR SELECT USING (auth.uid() = organizer_id);

CREATE POLICY "Organizers can manage their own events" ON public.events
    FOR ALL USING (auth.uid() = organizer_id);

CREATE POLICY "Approved organizers can create events" ON public.events
    FOR INSERT WITH CHECK (
        auth.uid() = organizer_id AND
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() 
            AND role = 'organizer' 
            AND organizer_status = 'approved'
        )
    );

-- Categories table policies
CREATE POLICY "Anyone can view categories for active events" ON public.categories
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.events 
            WHERE id = event_id AND status = 'active'
        )
    );

CREATE POLICY "Organizers can manage categories for their events" ON public.categories
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.events 
            WHERE id = event_id AND organizer_id = auth.uid()
        )
    );

-- Contestants table policies
CREATE POLICY "Anyone can view contestants for active events" ON public.contestants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.categories c
            JOIN public.events e ON c.event_id = e.id
            WHERE c.id = category_id AND e.status = 'active'
        )
    );

CREATE POLICY "Organizers can manage contestants for their events" ON public.contestants
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.categories c
            JOIN public.events e ON c.event_id = e.id
            WHERE c.id = category_id AND e.organizer_id = auth.uid()
        )
    );

-- Votes table policies
CREATE POLICY "Users can view their own votes" ON public.votes
    FOR SELECT USING (auth.uid() = voter_id);

CREATE POLICY "Authenticated users can create votes" ON public.votes
    FOR INSERT WITH CHECK (auth.uid() = voter_id);

CREATE POLICY "Organizers can view votes for their events" ON public.votes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.events 
            WHERE id = event_id AND organizer_id = auth.uid()
        )
    );

-- Payments table policies
CREATE POLICY "Users can view their own payments" ON public.payments
    FOR SELECT USING (auth.uid() = voter_id);

CREATE POLICY "Organizers can view payments for their events" ON public.payments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.events 
            WHERE id = event_id AND organizer_id = auth.uid()
        )
    );

CREATE POLICY "System can manage payments" ON public.payments
    FOR ALL USING (true);

-- Platform settings policies
CREATE POLICY "Anyone can view platform settings" ON public.platform_settings
    FOR SELECT USING (true);

CREATE POLICY "Only admins can modify platform settings" ON public.platform_settings
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Withdrawals table policies
CREATE POLICY "Organizers can view their own withdrawals" ON public.withdrawals
    FOR SELECT USING (auth.uid() = organizer_id);

CREATE POLICY "Organizers can create withdrawal requests" ON public.withdrawals
    FOR INSERT WITH CHECK (auth.uid() = organizer_id);

-- Functions and Triggers

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contestants_updated_at BEFORE UPDATE ON public.contestants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update vote counts and revenue
CREATE OR REPLACE FUNCTION update_vote_counts()
RETURNS TRIGGER AS $$
BEGIN
    -- Update contestant vote count
    UPDATE public.contestants 
    SET vote_count = vote_count + 1,
        updated_at = NOW()
    WHERE id = NEW.contestant_id;
    
    -- Update event total votes and revenue
    UPDATE public.events 
    SET total_votes = total_votes + 1,
        total_revenue = total_revenue + NEW.amount,
        updated_at = NOW()
    WHERE id = NEW.event_id;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to update counts when vote is inserted
CREATE TRIGGER update_vote_counts_trigger 
    AFTER INSERT ON public.votes
    FOR EACH ROW EXECUTE FUNCTION update_vote_counts();

-- Function to handle user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
    RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Trigger for new user creation
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Insert default platform settings
INSERT INTO public.platform_settings (commission_rate) VALUES (0.05);

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES 
    ('event-banners', 'event-banners', true),
    ('contestant-images', 'contestant-images', true);

-- Storage policies
CREATE POLICY "Anyone can view event banners" ON storage.objects
    FOR SELECT USING (bucket_id = 'event-banners');

CREATE POLICY "Organizers can upload event banners" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'event-banners' AND auth.role() = 'authenticated');

CREATE POLICY "Anyone can view contestant images" ON storage.objects
    FOR SELECT USING (bucket_id = 'contestant-images');

CREATE POLICY "Organizers can upload contestant images" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'contestant-images' AND auth.role() = 'authenticated');