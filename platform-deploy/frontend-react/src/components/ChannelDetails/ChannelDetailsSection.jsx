/* eslint-disable */
import React from 'react';
import ConnectIcon from '../../public/icons/general/png/Connect.png';
import NodeDetailsItem from "../NodeDetails/NodeDetailsItem";
import CopyNodeDetailsItem from "../NodeDetails/CopyNodeDetailsItem";

export default function ChannelDetailsSection({data}) {
  return (
    <div className='channel-details-section container my-3'>
        <div className='row'>
            <div className='my-2 col-12 col-md-12'><img src={ConnectIcon}></img>Channel details</div>
            <NodeDetailsItem title="Channel ID" value={data.channelId}/>
            <CopyNodeDetailsItem title={'Channel Point'} value={data.channelPoint}/>
            <CopyNodeDetailsItem title={'Remote Pubkey'} value={data.remotePubKey}/>
            <NodeDetailsItem title="Commit Fee" value={data.commitFee ? data.commitFee : 0 + ' sats'}/>
            <NodeDetailsItem title="Commit Weight" value={data.commitWeight ? data.commitWeight : 0 + ' sats'}/>
            <NodeDetailsItem title="Fee Per KW" value={data.feePerKw ? data.feePerKw : 0 + ' sats'}/>
        </div>
    </div>
  );
}
