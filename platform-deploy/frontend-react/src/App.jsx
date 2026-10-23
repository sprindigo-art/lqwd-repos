import React from 'react';
import './app.css';

import { BrowserRouter as Router, useRoutes } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';

import { ProtectedRoute } from './Routes/ProtectedRoute';
import Layout from './containers/Layout/Layout';
import SettingsLayout from './containers/Layout/SettingsLayout';

import LoginPage from './containers/LoginPage/LoginPage';
import MyNode from './containers/MyNode/MyNode';
import Dashboard from './containers/Dashboard/Dashboard';
import PayInvoice from './containers/PayInvoice/PayInvoice';
import SendPayment from './containers/SendPayment/SendPayment';
import MyChannels from './containers/MyChannels/MyChannels';
import PayKeySend from './containers/PayKeySend/PayKeySend';
import Withdraw from './containers/Withdraw/Withdraw';
import RequestPayment from './containers/RequestPayment/RequestPayment';
import RqPaymentCreateInvoice from './containers/RqPaymentCreateInvoice/RqPaymentCreateInvoice';
import RqPaymentKeySend from './containers/RqPaymentKeysend/RqPaymentKeysend';
import SignupPage from './containers/SignupPage/SignupPage';
import ResetPasswordPage from './containers/ResetPasswordPage/ResetPasswordPage';
import Transactions from './containers/TransactionsPage/TransactionsPage';
import Subscription from './containers/Subscription/Subscription';
import ManageApi from './containers/ManageApi/ManageApi';
import APIKeyPage from './containers/APIKeyPage/APIKeyPage';
import RequestAccounting from './containers/RequestAccounting/RequestAccounting';
import DIAUsagePage from './containers/DIAUsagePage/DIAUsagePage';
import VerifyPage from './containers/VerifyPage/VerifyPage';
import VerifyLandingPage from './containers/VerifyLandingPage/VerifyLandingPage';
import ConfirmResetPassword from './containers/ConfirmResetPassword/ConfirmResetPassword';
import PaymentHistory from './containers/PaymentHistory/PaymentHistory';
import LegalTerms from './containers/LegalTerms/LegalTerms';
import SettingsPage from './containers/SettingsPage/SettingsPage';
import SettingsPassword from './containers/SettingsPage/SettingsPassword';
import SharedNodeAccess from './containers/SharedNodeAccess/SharedNodeAccess';

const App = () => {
  const routes = useRoutes([
    {
      path: '/',
      element: (
        <ProtectedRoute>
          <Layout mobile>
            <Dashboard />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'nodes',
      element: (
        <ProtectedRoute>
          <Layout mobile>
            <MyNode />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'channels',
      element: (
        <ProtectedRoute>
          <Layout mobile>
            <MyChannels />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'send-payment',
      element: (
        <ProtectedRoute>
          <Layout>
            <SendPayment />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'request-payment',
      element: (
        <ProtectedRoute>
          <Layout>
            <RequestPayment />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'create-invoice',
      element: (
        <ProtectedRoute>
          <Layout>
            <RqPaymentCreateInvoice />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'create-invoice-direct',
      element: (
        <ProtectedRoute>
          <Layout>
            <RqPaymentKeySend />
          </Layout>
        </ProtectedRoute>
      ),
    },

    {
      path: 'pay-invoice',
      element: (
        <ProtectedRoute>
          <Layout>
            <PayInvoice />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'pay-direct',
      element: (
        <ProtectedRoute>
          <Layout>
            <PayKeySend />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'withdraw',
      element: (
        <ProtectedRoute>
          <Layout mobile>
            <Withdraw />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'transactions',
      element: (
        <ProtectedRoute>
          <Layout mobile>
            <Transactions />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'support_manage_api',
      element: (
        <ProtectedRoute>
          <Layout>
            <ManageApi />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'support_apikey',
      element: (
        <ProtectedRoute>
          <Layout>
            <APIKeyPage />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'support_request_accounting',
      element: (
        <ProtectedRoute>
          <Layout>
            <RequestAccounting />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'support_dla_usage',
      element: (
        <ProtectedRoute>
          <Layout>
            <DIAUsagePage />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'subscribe',
      element: (
        <ProtectedRoute>
          <Layout mobile>
            <Subscription />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'payment-history',
      element: (
        <ProtectedRoute>
          <Layout>
            <PaymentHistory />
          </Layout>
        </ProtectedRoute>
      ),
    },
    {
      path: 'share-access',
      element: (
        <ProtectedRoute>
          <Layout>
            <SharedNodeAccess />
          </Layout>
        </ProtectedRoute>
      ),
    },
    ...(process.env.REACT_APP_FEATURES_PROFILE_SETTINGS === 'on'
      ? [
          {
            path: 'settings_profile',
            element: (
              <ProtectedRoute>
                <SettingsLayout>
                  <SettingsPage />
                </SettingsLayout>
              </ProtectedRoute>
            ),
          },
          {
            path: 'settings_password',
            element: (
              <ProtectedRoute>
                <SettingsLayout>
                  <SettingsPassword />
                </SettingsLayout>
              </ProtectedRoute>
            ),
          },
        ]
      : []),

    {
      path: 'login',
      element: <LoginPage />,
    },
    {
      path: 'signup',
      element: <SignupPage />,
    },
    {
      path: 'reset-password',
      element: <ResetPasswordPage />,
    },
    {
      path: 'verify-email',
      element: (
        <ProtectedRoute>
          <VerifyPage />
        </ProtectedRoute>
      ),
    },
    {
      path: 'confirm-account',
      element: <VerifyLandingPage />,
    },
    {
      path: 'confirm-password',
      element: <ConfirmResetPassword />,
    },
    {
      path: 'terms-service',
      element: <LegalTerms terms="terms-service" />,
    },
    {
      path: 'privacy-policy',
      element: <LegalTerms terms="privacy-policy" />,
    },
  ]);
  return routes;
};

const AppWrapper = () => {
  return (
    <Router>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Router>
  );
};

export default AppWrapper;
