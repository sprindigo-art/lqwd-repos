/* eslint-disable */
import React from 'react';
import './NodeBalance.css';
import {Line} from 'react-chartjs-2';
import usdIco from '../../public/icons/dashboard/usd-ref-white.svg'

import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Filler,
    Legend
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Filler,
    Legend,
);

ChartJS.register(
    {
        id: 'uniqueid5', //typescript crashes without id
        afterDraw: function (chart, easing) {

            if(chart.tooltip == undefined)
                return;

            if (chart.tooltip._active && chart.tooltip._active.length) {
                const activePoint = chart.tooltip._active[0];
                const ctx = chart.ctx;
                const x = activePoint.element.x;
                const topY = chart.scales.y.top;
                const bottomY = chart.scales.y.bottom;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, topY);
                ctx.lineTo(x, bottomY);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.stroke();
                ctx.restore();
            }
        }
    }
);


Tooltip.positioners.myCustomPositioner = function (elements, eventPosition) {
    // A reference to the tooltip model
    const tooltip = this;

    /* ... */

    return {
        x: eventPosition.x,
        y: 0,
        yAlign: "bottom"
    };
};

function getChartOptions(month, currency) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            tooltip: {
                position: "myCustomPositioner",
                displayColors: false,
                backgroundColor: '#ffffff',
                titleColor: '#000000',
                bodyColor: '#7A7A7A',
                caretSize: 0,
                callbacks: {
                    title: function(context) {
                        return `${context[0].formattedValue} ${currency}`;
                    },
                    label: function(context) {
                        return context.label
                    },
                }
            },
            legend: {
                display: false,
            },
            title: {
                display: true,
                align: 'start',
                color: '#FFFFFF',
                font: {size: 14, family: 'Inter', weight: 'normal'},
                text: `Balance history - ${month}`,
            },


        },
        interaction: {
            mode: 'index',
            intersect: false,
        },
        elements: {
            point: {
                borderWidth: 0,
                radius: 0,
                backgroundColor: 'rgba(0,0,0,0)'
            }
        },
        scales: {
            x: {
                display: false,
                gridLines: {
                    // You can change the color, the dash effect, the main axe color, etc.
                    display: false
                }
            },
            y: {
                position: 'right',
                grid: {
                    // You can change the color, the dash effect, the main axe color, etc.
                    borderDash: [8, 4],
                    color: "rgba(255, 255, 255, 0.3)"
                },
                ticks: {
                    color: "#FFFFFF", // this here
                },
            }
        }
    }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']

function getAllDaysInMonth(year, month) {
    const date = new Date(year, month, 1);

    const dates = [];

    while (date.getMonth() === month) {
        let d = new Date(date)
        let dateString = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

        dates.push(dateString);
        date.setDate(date.getDate() + 1);
    }

    return dates;
}

const now = new Date();
const labels = getAllDaysInMonth(now.getFullYear(), now.getMonth());
const currentMonth = MONTHS[now.getMonth()];


function getChartData(balances, currency) {
    let convertedBalances = [];
    for (let i = 0; i < balances.length; i++){
        convertedBalances.push(balances[i] * currency.rate)
    }

    return {
        labels: labels,
        datasets: [{
            borderColor: '#FFFFFF',
            data: convertedBalances,
            backgroundColor: [
                "rgba(255, 255, 255, 0.5)",
                "rgba(255, 255, 255, 0)",
            ],
            fill: {
                target: 'origin'
            }
        }]
    };
}

const formatNumber = (num, currency) => {
    let convertedBal = num * currency.rate
    return convertedBal.toLocaleString('en-US', {
        minimumFractionDigits: 2
    })
}

function getCurrencies(currenciesMap) {
    let currencies = []
    for (const key in currenciesMap) {
        currencies.push(currenciesMap[key]);
    }
    return currencies;
}


export default function NodeBalance({allCurrencies,balanceHistory, currency, balance,
                                    selectCurrencyFunc}) {

    let chartData = getChartData(balanceHistory, currency);
    let currencies = getCurrencies(allCurrencies);
    let chartOptions = getChartOptions(currentMonth, currency.code);

    return (
        <div className='node-balance-component'>
            <div className='flex-column'>
                <div className='d-sm-flex p-2'>
                    <span className='balance-title'>All node balance combined</span>
                </div>

                <div className='d-sm-flex p-2'>
                    <div id='balance' className='balance-container d-inline-flex flex-row'>
                        <div className='node-balance p-2'>
                            <h2>{formatNumber(balance, currency)} <sub>{currency.code}</sub></h2>
                        </div>

                        <div className="dropend rounded-circle p-2">
                            <img role="button"
                                 id="dropdownMenuLink" data-bs-toggle="dropdown" aria-expanded="false"
                                 className='currency rounded-circle p-2 ' src={usdIco}/>


                            <ul className="dropdown-menu" aria-labelledby="dropdownMenuLink">
                                {currencies.map((item, num) => (
                                    <li key={item.code}><a className="dropdown-item currency-name" href="#"
                                           onClick={() => selectCurrencyFunc(item)}>{item.name} ({item.code})</a>
                                    </li>))}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
            <div className="chart">
            <Line options={chartOptions} data={chartData}/>
            </div>

        </div>

    );
}
