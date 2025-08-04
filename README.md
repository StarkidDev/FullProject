# Eventa - Web-Based Voting Platform

A comprehensive web-based platform that allows event organizers to host paid voting events, enabling the public to vote by paying through Stripe (card payments) and Paystack (Mobile Money).

## 🌟 Features

### 🎛 Organizer Features
- **Event Management**: Create, edit, and manage voting events
- **Categories & Contestants**: Add award/election categories and contestants
- **Pricing Control**: Set custom vote prices
- **Real-time Analytics**: View vote counts and earnings in real-time
- **Revenue Tracking**: Monitor earnings with platform commission breakdown
- **Withdrawal System**: Request and track earnings withdrawals

### 🗳 Voter Features
- **Event Discovery**: Browse available voting events
- **Secure Voting**: Cast votes with payment verification
- **Multiple Payment Methods**: 
  - Stripe for debit/credit cards
  - Paystack for Ghanaian Mobile Money (MTN, AirtelTigo, Vodafone)
- **Vote History**: Track personal voting history
- **Real-time Results**: View live vote counts and leaderboards

### 🛡 Admin Features
- **User Management**: Approve/block organizers and manage users
- **Platform Settings**: Configure commission rates and payment methods
- **Analytics Dashboard**: View platform-wide metrics and revenue
- **Content Moderation**: Monitor and manage events and users

## 🏗 Architecture

### Backend (Node.js/Express)
- **Authentication**: Supabase Auth with JWT tokens
- **Database**: PostgreSQL with Supabase
- **Payments**: Stripe + Paystack integration
- **File Storage**: Supabase Storage for images
- **API**: RESTful API with role-based access control

### Frontend (React)
- **UI Framework**: React 18 with React Router
- **Styling**: Tailwind CSS with custom components
- **State Management**: React Context + Custom hooks
- **Payments**: Stripe Elements + Paystack Popup
- **Real-time Updates**: Supabase Realtime subscriptions

### Security Features
- **Row-Level Security (RLS)**: Database-level access control
- **JWT Authentication**: Secure session management
- **Role-based Authorization**: Admin, Organizer, Voter roles
- **Payment Verification**: Webhook-based payment confirmation
- **Input Validation**: Comprehensive validation on all endpoints

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm
- Supabase account
- Stripe account
- Paystack account (for Ghana Mobile Money)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd eventa-platform
   ```

2. **Install dependencies**
   ```bash
   npm run install-all
   ```

3. **Environment Setup**
   
   Copy environment files:
   ```bash
   cp .env.example .env
   cp client/.env.example client/.env
   ```

4. **Configure Environment Variables**

   **Backend (.env):**
   ```env
   PORT=5000
   NODE_ENV=development
   
   # Supabase Configuration
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   
   # Stripe Configuration
   STRIPE_SECRET_KEY=your_stripe_secret_key
   STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
   STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
   
   # Paystack Configuration
   PAYSTACK_SECRET_KEY=your_paystack_secret_key
   PAYSTACK_PUBLIC_KEY=your_paystack_public_key
   
   # JWT Configuration
   JWT_SECRET=your_jwt_secret_key_here
   
   # Platform Configuration
   PLATFORM_COMMISSION_RATE=0.05
   FRONTEND_URL=http://localhost:3000
   ```

   **Frontend (client/.env):**
   ```env
   REACT_APP_SUPABASE_URL=your_supabase_url
   REACT_APP_SUPABASE_ANON_KEY=your_supabase_anon_key
   REACT_APP_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
   REACT_APP_PAYSTACK_PUBLIC_KEY=your_paystack_public_key
   REACT_APP_API_URL=http://localhost:5000
   ```

5. **Database Setup**
   
   Run the SQL schema in your Supabase dashboard:
   ```bash
   # Copy the contents of database/schema.sql and run in Supabase SQL editor
   ```

6. **Start Development Servers**
   ```bash
   npm run dev
   ```

   This will start:
   - Backend server on http://localhost:5000
   - Frontend application on http://localhost:3000

## 📁 Project Structure

```
eventa-platform/
├── client/                     # React frontend
│   ├── public/
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── contexts/          # React contexts
│   │   ├── pages/             # Page components
│   │   ├── config/            # Configuration files
│   │   └── utils/             # Utility functions
│   ├── package.json
│   └── tailwind.config.js
├── config/                     # Backend configuration
│   ├── supabase.js
│   └── stripe.js
├── database/                   # Database schema and migrations
│   └── schema.sql
├── middleware/                 # Express middleware
│   └── auth.js
├── routes/                     # API routes
│   ├── auth.js
│   ├── events.js
│   ├── payments.js
│   ├── admin.js
│   └── webhooks/
├── server.js                   # Express server entry point
└── package.json
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user profile
- `PUT /api/auth/me` - Update user profile

### Events
- `GET /api/events` - Get public events
- `POST /api/events` - Create event (organizers)
- `GET /api/events/:id` - Get event details
- `PUT /api/events/:id` - Update event
- `POST /api/events/:id/activate` - Activate event
- `DELETE /api/events/:id` - Delete event

### Payments
- `POST /api/payments/stripe/create-intent` - Create Stripe payment
- `POST /api/payments/paystack/initialize` - Initialize Paystack payment
- `GET /api/payments/verify/:id` - Verify payment status

### Admin
- `GET /api/admin/dashboard` - Admin dashboard data
- `GET /api/admin/users` - User management
- `PUT /api/admin/settings` - Update platform settings

## 💳 Payment Integration

### Stripe (Card Payments)
- Credit/Debit card processing
- Secure payment intents
- Webhook-based confirmation
- Automatic retry logic

### Paystack (Mobile Money)
- MTN Mobile Money
- AirtelTigo Money
- Vodafone Cash
- Bank card payments

## 🗄 Database Schema

The platform uses PostgreSQL with the following main tables:

- **users** - User profiles and roles
- **events** - Voting events
- **categories** - Award/election categories
- **contestants** - Contest participants
- **votes** - Vote records with payment linkage
- **payments** - Payment transactions
- **withdrawals** - Organizer earnings withdrawals
- **platform_settings** - System configuration

## 🔒 Security

### Row-Level Security (RLS)
- Database-level access control
- User isolation
- Role-based data filtering

### Authentication & Authorization
- JWT-based session management
- Role-based access control (Admin, Organizer, Voter)
- Secure password handling

### Payment Security
- Webhook signature verification
- Payment state validation
- Duplicate payment prevention

## 🚀 Deployment

### Backend Deployment
1. Deploy to your preferred platform (Heroku, Railway, DigitalOcean)
2. Set environment variables
3. Configure webhook endpoints in Stripe/Paystack dashboards

### Frontend Deployment
1. Build the React app: `npm run build`
2. Deploy to Netlify, Vercel, or your preferred platform
3. Set environment variables

### Database
- Supabase provides hosted PostgreSQL
- Run schema.sql in Supabase SQL editor
- Configure RLS policies

## 🔧 Configuration

### Platform Settings
- Commission rate (default: 5%)
- Payment method toggles
- Minimum withdrawal amounts

### Payment Provider Setup

**Stripe:**
1. Create Stripe account
2. Get API keys from dashboard
3. Configure webhook endpoint
4. Set up products and pricing

**Paystack:**
1. Create Paystack account
2. Get API keys
3. Configure webhook endpoint
4. Set up payment channels

## 📱 Mobile Responsiveness

The platform is fully responsive and optimized for:
- Mobile phones (320px+)
- Tablets (768px+)
- Desktop computers (1024px+)

Key mobile features:
- Touch-friendly interface
- Mobile payment optimization
- Responsive navigation
- Optimized forms

## 🧪 Development

### Running Tests
```bash
# Backend tests
npm test

# Frontend tests
cd client && npm test
```

### Code Quality
```bash
# Lint backend code
npm run lint

# Lint frontend code
cd client && npm run lint
```

### Database Migrations
```bash
# Run new migrations
npm run migrate

# Reset database
npm run db:reset
```

## 🐛 Troubleshooting

### Common Issues

1. **Supabase Connection Issues**
   - Verify environment variables
   - Check Supabase project status
   - Ensure RLS policies are correctly set

2. **Payment Webhook Issues**
   - Verify webhook URLs in provider dashboards
   - Check webhook secret configuration
   - Monitor webhook logs

3. **Build Issues**
   - Clear node_modules and reinstall
   - Check Node.js version compatibility
   - Verify environment variables

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For support and questions:
- Open an issue on GitHub
- Check the documentation
- Review the FAQ section

## 🗺 Roadmap

### Upcoming Features
- [ ] USSD voting integration
- [ ] Free voting events
- [ ] Event ticketing system
- [ ] Advanced analytics
- [ ] Mobile app (React Native)
- [ ] Multi-language support
- [ ] Email notifications
- [ ] SMS notifications

---

**Eventa** - Empowering democratic participation through secure, accessible voting technology.
