/*eslint-disable*/
import React, { useRef } from 'react';
import { useDraggable } from 'react-use-draggable-scroll';
import './MyChannelsHeader.css';

export default function MyChannelsHeader({ state, onClickHandle, isActiveNode, nodeState }) {
  const myChannelState = state;

  const ref = useRef();
  const { events } = useDraggable(ref);

  const activeTextColor = (isActive) =>{
    return isActive ? "#000000" : "#B2B2B2"
  }


  return (
    <div className="my-channels-header-item-container" {...events} ref={ref}>
      {myChannelState.myNodes.length > 0 ?

        myChannelState.myNodes.map((item, num) => (
        <div
          className="my-channels-header-item d-flex py-3 mx-2 "
          onClick={() => onClickHandle(num)}>
          <div
            id={num}
            style={{"color": activeTextColor(isActiveNode[num])}}
            className="ms-1 d-flex flex-column justify-content-center my-channels-header-item-text">
            {item.lndNodeName}
          </div>
          <div
            className={
              isActiveNode[num] ? 'my-channels-header-item-active' : ''
            }></div>
        </div>
      ))
      :
        <></>
      }

      {nodeState.sharedNodeList.length > 0 ?

        nodeState.sharedNodeList.map((item, num) => (
        <div
          className="my-channels-header-item d-flex py-3 mx-2 "
          onClick={() => onClickHandle(num)}>
          <div
            id={num}
            style={{"color": activeTextColor(isActiveNode[num])}}
            className="ms-1 d-flex flex-column justify-content-center my-channels-header-item-text">
            {item.lndNodeName}
          </div>
          <div
            className={
              isActiveNode[num] ? 'my-channels-header-item-active' : ''
            }></div>
        </div>
      ))
      :
        <></>
      }
    </div>
  );
}
