export function getNodeAttributes(status) {
  switch (status) {
    case 'CREATING':
      return {
        badge_color: '#FEE8C7',
        badge_text: 'Creating',
      };
    case 'PENDING':
      return {
        badge_color: '#FEE8C7',
        badge_text: 'Pending',
      };
    case 'RUNNING':
      return {
        badge_color: '#B7F6B6',
        badge_text: 'Running',
      };
    case 'DELETED':
      return {
        badge_color: '#B7F6B6',
        badge_text: 'DELETED',
      };
    case 'NEED_RESTART':
      return {
        badge_color: '#F8A3A3',
        badge_text: 'Action needed',
      };
    case 'RESTARTING':
      return {
        badge_color: '#F8A3A3',
        badge_text: 'Restarting',
      };
    case 'IS_AWAITING_WALLET_UNLOCK':
      return {
        badge_color: '#F8A3A3',
        badge_text: 'unlock wallet',
      };
    case 'IS_WAITING_USER_CONFIRMATION':
      return {
        badge_color: '#FEE8C7',
        badge_text: 'Waiting for Confirmation',
      };

    default:
      return {
        badge_color: '#B7F6B6',
        badge_text: 'Unknown',
      };
  }
}
