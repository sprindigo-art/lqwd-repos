/* eslint-disable */
import React from 'react';
import PropTypes from "prop-types";

const TransactionFeeItem = ({ priority, rate, className }) => {

  const unit = 'Sat/vByte';
  const title = priority == 'low' ? 'Low Priority' : priority == 'medium' ? 'Medium Priority' : priority == 'high' ? 'High Priority' : '';
  const description =
    priority == 'low' ? 'It will be processed in the next 3 blocks. (~30 mins)'
      : priority == 'medium' ? 'It will be processed in the next 2 blocks. (~10 mins)'
        : priority == 'high' ? 'It will be processed in the next block.(less than 10 mins)'
          : '';

  return (
    <div className={`container transaction-fee-rates-item ${priority}-priority ` +  className}>
      <div className="row">
        <div className="col-12 d-flex">
          <div className='d-flex flex-column justify-content-center px-1'><div className="dot"></div></div>
          <div className="title px-1">{title}</div>
        </div>
        <div className="col-12">
          <div className='description'>{description}</div>
        </div>
        <div className="col-12">
          <div className='rates'>{rate + " " + unit}</div>
        </div>
      </div>
    </div>
  );
}

TransactionFeeItem.propTypes = {
  priority: PropTypes.oneOf(['low', 'medium', 'high']).isRequired,
  rate: PropTypes.number.isRequired
};

export default TransactionFeeItem;