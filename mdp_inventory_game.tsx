import React, { useState, useEffect } from 'react';
import { Package, Truck, Ship, Train, Globe, Play, Pause, RotateCcw, Settings, TrendingUp, DollarSign, AlertCircle } from 'lucide-react';

const MDPInventoryGame = () => {
  const [gameState, setGameState] = useState({
    inventory: 50,
    cash: 10000,
    day: 1,
    demand: 0,
    orderInTransit: 0,
    transportMode: 'truck',
    phase: 'supplier',
    totalRevenue: 0,
    totalCost: 0,
    stockouts: 0
  });

  const [config, setConfig] = useState({
    maxInventory: 100,
    orderCost: 50,
    holdingCost: 2,
    stockoutCost: 20,
    sellingPrice: 15,
    demandMean: 10,
    demandStd: 3,
    gamma: 0.95,
    sPolicy: 30,
    SPolicy: 70
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [valueFunction, setValueFunction] = useState({});
  const [policy, setPolicy] = useState({});

  const transportModes = {
    truck: { cost: 100, time: 1, icon: Truck, color: 'bg-blue-500' },
    ship: { cost: 50, time: 3, icon: Ship, color: 'bg-cyan-500' },
    rail: { cost: 75, time: 2, icon: Train, color: 'bg-green-500' },
    air: { cost: 200, time: 0, icon: Globe, color: 'bg-purple-500' }
  };

  const phases = [
    { id: 'supplier', name: 'Supplier', icon: Package },
    { id: 'manufacturer', name: 'Manufacturer', icon: Settings },
    { id: 'distributor', name: 'Distributor', icon: TrendingUp },
    { id: 'retailer', name: 'Retailer', icon: DollarSign }
  ];

  const generateDemand = () => {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(config.demandMean + z * config.demandStd));
  };

  const calculateReward = (state, action) => {
    const demand = generateDemand();
    const sales = Math.min(state, demand);
    const revenue = sales * config.sellingPrice;
    const holdingCost = state * config.holdingCost;
    const orderCost = action > 0 ? config.orderCost + action * 5 : 0;
    const stockoutCost = Math.max(0, demand - state) * config.stockoutCost;
    return revenue - holdingCost - orderCost - stockoutCost;
  };

  const valueIteration = () => {
    const V = {};
    const P = {};
    const iterations = 100;
    
    for (let s = 0; s <= config.maxInventory; s++) {
      V[s] = 0;
      P[s] = 0;
    }

    for (let iter = 0; iter < iterations; iter++) {
      const Vnew = {};
      for (let s = 0; s <= config.maxInventory; s++) {
        let maxValue = -Infinity;
        let bestAction = 0;

        for (let a = 0; a <= config.maxInventory - s; a++) {
          let expectedValue = 0;
          for (let d = 0; d <= config.demandMean * 3; d++) {
            const prob = Math.exp(-0.5 * Math.pow((d - config.demandMean) / config.demandStd, 2)) / (config.demandStd * Math.sqrt(2 * Math.PI));
            const nextState = Math.max(0, Math.min(config.maxInventory, s + a - d));
            const reward = calculateReward(s, a);
            expectedValue += prob * (reward + config.gamma * V[nextState]);
          }

          if (expectedValue > maxValue) {
            maxValue = expectedValue;
            bestAction = a;
          }
        }

        Vnew[s] = maxValue;
        P[s] = bestAction;
      }

      let delta = 0;
      for (let s = 0; s <= config.maxInventory; s++) {
        delta = Math.max(delta, Math.abs(V[s] - Vnew[s]));
        V[s] = Vnew[s];
      }

      if (delta < 0.01) break;
    }

    setValueFunction(V);
    setPolicy(P);
  };

  useEffect(() => {
    valueIteration();
  }, [config]);

  const simulateDay = () => {
    const demand = generateDemand();
    const sales = Math.min(gameState.inventory, demand);
    const revenue = sales * config.sellingPrice;
    const stockout = demand > gameState.inventory;
    
    let newInventory = gameState.inventory - sales;
    let orderCost = 0;
    let newOrderInTransit = gameState.orderInTransit;

    if (gameState.inventory <= config.sPolicy && gameState.orderInTransit === 0) {
      const orderAmount = config.SPolicy - gameState.inventory;
      orderCost = config.orderCost + orderAmount * 5 + transportModes[gameState.transportMode].cost;
      newOrderInTransit = orderAmount;
    }

    if (transportModes[gameState.transportMode].time === 0 && newOrderInTransit > 0) {
      newInventory += newOrderInTransit;
      newOrderInTransit = 0;
    }

    const holdingCost = newInventory * config.holdingCost;
    const stockoutCost = stockout ? (demand - sales) * config.stockoutCost : 0;
    const profit = revenue - holdingCost - orderCost - stockoutCost;

    setGameState(prev => ({
      ...prev,
      inventory: Math.min(config.maxInventory, newInventory),
      cash: prev.cash + profit,
      day: prev.day + 1,
      demand,
      orderInTransit: newOrderInTransit,
      totalRevenue: prev.totalRevenue + revenue,
      totalCost: prev.totalCost + holdingCost + orderCost + stockoutCost,
      stockouts: prev.stockouts + (stockout ? 1 : 0),
      phase: phases[(phases.findIndex(p => p.id === prev.phase) + 1) % phases.length].id
    }));
  };

  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(simulateDay, 1500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, gameState]);

  const resetGame = () => {
    setGameState({
      inventory: 50,
      cash: 10000,
      day: 1,
      demand: 0,
      orderInTransit: 0,
      transportMode: 'truck',
      phase: 'supplier',
      totalRevenue: 0,
      totalCost: 0,
      stockouts: 0
    });
    setIsPlaying(false);
  };

  const currentPhaseIndex = phases.findIndex(p => p.id === gameState.phase);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-bold text-slate-800 mb-2">MDP Inventory Control</h1>
              <p className="text-slate-600">Supply Chain Optimization Game</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                  isPlaying ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-500 hover:bg-emerald-600'
                } text-white shadow-lg`}
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                {isPlaying ? 'Pause' : 'Start'}
              </button>
              <button
                onClick={resetGame}
                className="px-6 py-3 bg-slate-600 hover:bg-slate-700 text-white rounded-xl font-semibold flex items-center gap-2 transition-all shadow-lg"
              >
                <RotateCcw size={20} />
                Reset
              </button>
              <button
                onClick={() => setShowControls(!showControls)}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold flex items-center gap-2 transition-all shadow-lg"
              >
                <Settings size={20} />
                Controls
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-xl border-2 border-blue-200">
              <div className="text-blue-600 text-sm font-semibold mb-1">Day</div>
              <div className="text-3xl font-bold text-blue-900">{gameState.day}</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-xl border-2 border-green-200">
              <div className="text-green-600 text-sm font-semibold mb-1">Cash</div>
              <div className="text-3xl font-bold text-green-900">${gameState.cash.toFixed(0)}</div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-xl border-2 border-purple-200">
              <div className="text-purple-600 text-sm font-semibold mb-1">Inventory</div>
              <div className="text-3xl font-bold text-purple-900">{gameState.inventory}</div>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-6 rounded-xl border-2 border-amber-200">
              <div className="text-amber-600 text-sm font-semibold mb-1">Demand</div>
              <div className="text-3xl font-bold text-amber-900">{gameState.demand}</div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Supply Chain Flow</h2>
            <div className="relative px-8">
              <div className="flex justify-between items-center">
                {phases.map((phase, index) => {
                  const Icon = phase.icon;
                  const isActive = index === currentPhaseIndex;
                  return (
                    <React.Fragment key={phase.id}>
                      <div className="flex flex-col items-center">
                        <div className={`w-24 h-24 rounded-2xl flex items-center justify-center mb-3 transition-all duration-300 ${
                          isActive ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-xl scale-110' : 'bg-slate-200'
                        }`}>
                          <Icon size={40} className={isActive ? 'text-white' : 'text-slate-600'} />
                        </div>
                        <div className={`text-sm font-semibold ${isActive ? 'text-blue-600' : 'text-slate-600'}`}>
                          {phase.name}
                        </div>
                      </div>
                      {index < phases.length - 1 && (
                        <div className="flex-1 flex flex-col items-center justify-center px-4 -mt-8">
                          <div className="bg-blue-50 rounded-lg p-2 mb-2 border border-blue-200 min-w-[120px]">
                            <div className="text-xs text-blue-600 font-semibold text-center">
                              {transportModes[gameState.transportMode].time}d transit
                            </div>
                            <div className="text-xs text-slate-600 text-center">
                              ${transportModes[gameState.transportMode].cost}
                            </div>
                          </div>
                          <div className="relative w-full h-0.5 bg-gradient-to-r from-blue-400 to-blue-500">
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-l-[12px] border-l-blue-500 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent"></div>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Transportation Mode</h2>
            <div className="grid grid-cols-4 gap-4">
              {Object.entries(transportModes).map(([mode, data]) => {
                const Icon = data.icon;
                const isSelected = gameState.transportMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => setGameState(prev => ({ ...prev, transportMode: mode }))}
                    className={`p-6 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 shadow-lg scale-105'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className={`w-16 h-16 ${data.color} rounded-xl flex items-center justify-center mx-auto mb-3`}>
                      <Icon size={32} className="text-white" />
                    </div>
                    <div className="text-center">
                      <div className="font-bold text-slate-800 capitalize mb-1">{mode}</div>
                      <div className="text-sm text-slate-600">Cost: ${data.cost}</div>
                      <div className="text-sm text-slate-600">Time: {data.time}d</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {gameState.orderInTransit > 0 && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 mb-6 flex items-center gap-3">
              <AlertCircle className="text-amber-600" size={24} />
              <div className="text-amber-800">
                <span className="font-semibold">Order in Transit:</span> {gameState.orderInTransit} units via {gameState.transportMode}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
              <div className="text-slate-600 text-sm font-semibold mb-2">Total Revenue</div>
              <div className="text-2xl font-bold text-slate-800">${gameState.totalRevenue.toFixed(0)}</div>
            </div>
            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
              <div className="text-slate-600 text-sm font-semibold mb-2">Total Costs</div>
              <div className="text-2xl font-bold text-slate-800">${gameState.totalCost.toFixed(0)}</div>
            </div>
            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
              <div className="text-slate-600 text-sm font-semibold mb-2">Stockouts</div>
              <div className="text-2xl font-bold text-slate-800">{gameState.stockouts}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border-2 border-slate-200 p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <TrendingUp size={20} className="text-blue-600" />
                Performance Dashboard
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Net Profit</span>
                  <span className={`text-lg font-bold ${gameState.totalRevenue - gameState.totalCost >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ${(gameState.totalRevenue - gameState.totalCost).toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Service Level</span>
                  <span className="text-lg font-bold text-blue-600">
                    {((1 - gameState.stockouts / Math.max(gameState.day, 1)) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Avg Daily Revenue</span>
                  <span className="text-lg font-bold text-purple-600">
                    ${(gameState.totalRevenue / Math.max(gameState.day, 1)).toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Profit Margin</span>
                  <span className="text-lg font-bold text-amber-600">
                    {gameState.totalRevenue > 0 ? (((gameState.totalRevenue - gameState.totalCost) / gameState.totalRevenue) * 100).toFixed(1) : 0}%
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border-2 border-slate-200 p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Package size={20} className="text-purple-600" />
                Inventory Metrics
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Current Level</span>
                  <span className="text-lg font-bold text-purple-600">
                    {gameState.inventory} / {config.maxInventory}
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-purple-500 to-purple-600 h-full transition-all duration-500"
                    style={{ width: `${(gameState.inventory / config.maxInventory) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Fill Rate</span>
                  <span className="text-lg font-bold text-green-600">
                    {gameState.demand > 0 ? ((Math.min(gameState.inventory, gameState.demand) / gameState.demand) * 100).toFixed(1) : 100}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Reorder Point (s)</span>
                  <span className="text-lg font-bold text-blue-600">{config.sPolicy}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Target Level (S)</span>
                  <span className="text-lg font-bold text-blue-600">{config.SPolicy}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border-2 border-slate-200 p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <DollarSign size={20} className="text-green-600" />
                Cost Breakdown
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm text-slate-600">Holding Costs</span>
                  <span className="text-base font-semibold text-slate-800">
                    ${(gameState.day * gameState.inventory * config.holdingCost / Math.max(gameState.day, 1)).toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm text-slate-600">Ordering Costs</span>
                  <span className="text-base font-semibold text-slate-800">
                    ${(config.orderCost * Math.floor(gameState.day / 5)).toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm text-slate-600">Stockout Penalties</span>
                  <span className="text-base font-semibold text-red-600">
                    ${(gameState.stockouts * config.stockoutCost).toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm text-slate-600">Transport Costs</span>
                  <span className="text-base font-semibold text-slate-800">
                    ${(transportModes[gameState.transportMode].cost * Math.floor(gameState.day / 5)).toFixed(0)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border-2 border-slate-200 p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <AlertCircle size={20} className="text-amber-600" />
                Real-Time Status
              </h3>
              <div className="space-y-3">
                <div className={`p-3 rounded-lg ${gameState.inventory <= config.sPolicy ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
                  <div className="text-xs font-semibold mb-1 text-slate-600">Inventory Status</div>
                  <div className={`text-sm font-bold ${gameState.inventory <= config.sPolicy ? 'text-amber-700' : 'text-green-700'}`}>
                    {gameState.inventory <= config.sPolicy ? '⚠️ Below Reorder Point' : '✓ Healthy Level'}
                  </div>
                </div>
                <div className={`p-3 rounded-lg ${gameState.demand > gameState.inventory ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className="text-xs font-semibold mb-1 text-slate-600">Last Demand</div>
                  <div className={`text-sm font-bold ${gameState.demand > gameState.inventory ? 'text-red-700' : 'text-blue-700'}`}>
                    {gameState.demand} units {gameState.demand > gameState.inventory ? '(Stockout!)' : '(Fulfilled)'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-purple-50 border border-purple-200">
                  <div className="text-xs font-semibold mb-1 text-slate-600">Transport Mode</div>
                  <div className="text-sm font-bold text-purple-700 capitalize">
                    {gameState.transportMode} (${transportModes[gameState.transportMode].cost})
                  </div>
                </div>
                <div className={`p-3 rounded-lg ${gameState.cash >= 10000 ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                  <div className="text-xs font-semibold mb-1 text-slate-600">Cash Position</div>
                  <div className={`text-sm font-bold ${gameState.cash >= 10000 ? 'text-green-700' : 'text-amber-700'}`}>
                    ${gameState.cash.toFixed(0)} {gameState.cash >= 10000 ? '✓' : '⚠️'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {showControls && (
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">Developer Control Panel</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Max Inventory (K)</label>
                <input
                  type="number"
                  value={config.maxInventory}
                  onChange={(e) => setConfig(prev => ({ ...prev, maxInventory: parseInt(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Order Cost</label>
                <input
                  type="number"
                  value={config.orderCost}
                  onChange={(e) => setConfig(prev => ({ ...prev, orderCost: parseInt(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Holding Cost per Unit</label>
                <input
                  type="number"
                  value={config.holdingCost}
                  onChange={(e) => setConfig(prev => ({ ...prev, holdingCost: parseInt(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Stockout Cost</label>
                <input
                  type="number"
                  value={config.stockoutCost}
                  onChange={(e) => setConfig(prev => ({ ...prev, stockoutCost: parseInt(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Selling Price</label>
                <input
                  type="number"
                  value={config.sellingPrice}
                  onChange={(e) => setConfig(prev => ({ ...prev, sellingPrice: parseInt(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Demand Mean (μ)</label>
                <input
                  type="number"
                  value={config.demandMean}
                  onChange={(e) => setConfig(prev => ({ ...prev, demandMean: parseInt(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Demand Std Dev (σ)</label>
                <input
                  type="number"
                  value={config.demandStd}
                  onChange={(e) => setConfig(prev => ({ ...prev, demandStd: parseInt(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Discount Factor (γ)</label>
                <input
                  type="number"
                  step="0.01"
                  value={config.gamma}
                  onChange={(e) => setConfig(prev => ({ ...prev, gamma: parseFloat(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">(s) Policy Threshold</label>
                <input
                  type="number"
                  value={config.sPolicy}
                  onChange={(e) => setConfig(prev => ({ ...prev, sPolicy: parseInt(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">(S) Policy Target</label>
                <input
                  type="number"
                  value={config.SPolicy}
                  onChange={(e) => setConfig(prev => ({ ...prev, SPolicy: parseInt(e.target.value) }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <button
              onClick={valueIteration}
              className="mt-6 w-full px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all shadow-lg"
            >
              Recompute Optimal Policy
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MDPInventoryGame;