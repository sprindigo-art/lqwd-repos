/* eslint-disable */
import React from 'react';

export default function ChannelDetailsSection({data}) {
  return (
    <div className='channel-details-summary-section container my-3'>
    <div className='row'>
        <div className='my-2 col-12 col-md-6 table-title'>Capacity</div>
        <div className='my-2 col-12 col-md-6 table-value '>{data.capacity} sats</div>
        <div className='my-2 col-12 col-md-6 table-title'>Settled Balance</div>
        <div className='my-2 col-12 col-md-6 table-value'>{data.settledBalance == null ? 0 : data.settledBalance} sats</div>
        <div className='my-2 col-12 col-md-6 table-title'>Unsettled Balance</div>
        <div className='my-2 col-12 col-md-6 table-value'>{data.unsettledBalance} sats</div>

    </div>
</div>
  );
}
