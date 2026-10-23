/* eslint-disable */
import React, { useState } from 'react';
import './SubscriptionItem.sass'
import PrimaryOutlineButton from '../../components/Buttons/PrimaryOutline'
import checkImage from '../../public/icons/subscription/Check.svg';


export default function SubscriptionItem({ onItemSelect, item, selected }) {

    return (
        <div className={selected ? 
            `subscription-item-${item.name.toLowerCase()} subscription-item p-2 subscription-item-selected` : 
            `subscription-item-${item.name.toLowerCase()} subscription-item p-2 `}>
            <div className='mx-4'><h1>{item.name}</h1></div>
            <div className='d-flex mx-4'><span style={{ fontWeight: 'bold' }}>{item.price}</span><span>{`/${item.period}`}</span></div>
            <div className='flex-grow-1 subscription-item-rows mt-3'>

                <ul>
                    {item.features.map((item, num) => (<li><img src={checkImage} />{item}</li>))}
                </ul>
            </div>
            <div className='w-100 d-flex justify-content-center'><PrimaryOutlineButton text={"Choose"} onClick={() => onItemSelect(item.id)}></PrimaryOutlineButton></div>
            <div className='selected-image'><img src={checkImage} /></div>
        </div>
    );
}
