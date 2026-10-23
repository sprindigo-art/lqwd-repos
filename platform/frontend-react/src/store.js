import { createStore, applyMiddleware, combineReducers } from 'redux';
import thunkMiddleware from 'redux-thunk';
import storage from 'redux-persist/lib/storage';
import { persistReducer, persistStore, createTransform } from 'redux-persist';
import createSagaMiddleware from 'redux-saga';

import globalReducer from './containers/App/AppReducer';
import headerReducer from './components/Header/HeaderReducer';
import userReducer from './containers/LoginPage/LoginPageReducer';
import channelDetailsReducer from './components/ChannelDetails/ChannelDetailsReducer';
import dashboardReducer from './containers/Dashboard/DashboardReducer';
import activateReducer from './containers/ActivateNode/ActivateNodeReducer';
import createNodeReducer from './containers/CreateNode/CreateNodeReducer';
import fundNodeReducer from './containers/FundNode/FundNodeReducer';
import restartNodeReducer from './containers/RestartNode/RestartNodeReducer';
import myChannelsReducer from './containers/MyChannels/MyChannelsReducer';
import payInvoiceReducer from './containers/PayInvoice/PayInvoiceReducer';
import StoreTransforms from './store.transforms';
import nodeReducer, {
  selectedNodeReducer,
} from './managers/nodeManager/nodeReducer';
import nodeDetailsReducer from './containers/NodeDetails/NodeDetailsReducer';
import deleteNodeReducer from './containers/DeleteNode/DeleteNodeReducer';
import payKeySendReducer from './containers/PayKeySend/PayKeySenndReducer';
import withdrawReducer from './containers/Withdraw/WithdrawReducer';
import rqPaymentInvoiceReducer from './containers/RqPaymentCreateInvoice/RqPaymentCreateInvoiceReducer';
import rqPaymentKeySendReducer from './containers/RqPaymentKeysend/RqPaymentKeysendReducer';
import signupPageReducer from './containers/SignupPage/SignupPageReducer';
import ServerConnectionBannerReducer from './containers/ServerConnectionBanner/ServerConnectionBannerReducer';
import TransactionsReducer from './containers/TransactionsPage/TransactionsPageReducer';
import subscriptionReducer from './containers/Subscription/SubscriptionReducer';
import verifyReducer from './containers/VerifyPage/VerifyPageReducer';
import confirmResetPasswordReducer from './containers/ConfirmResetPassword/ConfirmResetPasswordReducer';
import manageApiReducer from './containers/ManageApi/ManageApiReducer';
import requestAccountingReducer from './containers/RequestAccounting/RequestAccountingReducer';
import NotifierReducer from './containers/Notifier/NotifierReducer';
import APIKeyPageReducer from './containers/APIKeyPage/APIKeyPageReducer';
import transactionDetailsReducer from './containers/TransactionDetails/TransactionDetailsReducer';
import SubscriptionInvoiceModalReducer from './containers/SubscriptionInvoiceModal/SubscriptionInvoiceModalReducer';
import shareNodeAccessReducer from './containers/SharedNodeAccess/ShareNodeAccessReducer';

export const sagaMiddleware = createSagaMiddleware();

const persistConfig = {
  key: 'root',
  transforms: StoreTransforms,
  storage,
};

const middlewares = [thunkMiddleware, sagaMiddleware];
const middleware = applyMiddleware(...middlewares);
const combinedReducers = combineReducers({
  globalReducer,
  nodeReducer,
  selectedNodeReducer,
  headerReducer,
  channelDetailsReducer,
  userReducer,
  signupPageReducer,
  dashboardReducer,
  activateReducer,
  fundNodeReducer,
  nodeDetailsReducer,
  deleteNodeReducer,
  payInvoiceReducer,
  createNodeReducer,
  myChannelsReducer,
  payKeySendReducer,
  withdrawReducer,
  rqPaymentInvoiceReducer,
  rqPaymentKeySendReducer,
  ServerConnectionBannerReducer,
  TransactionsReducer,
  subscriptionReducer,
  verifyReducer,
  confirmResetPasswordReducer,
  manageApiReducer,
  requestAccountingReducer,
  NotifierReducer,
  restartNodeReducer,
  APIKeyPageReducer,
  transactionDetailsReducer,
  SubscriptionInvoiceModalReducer,
  shareNodeAccessReducer,
});

const persistedReducer = persistReducer(persistConfig, combinedReducers);

const Store = createStore(persistedReducer, middleware);

export default Store;

export const persistor = persistStore(Store);
