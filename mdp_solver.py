import numpy as np
import json
from scipy.stats import norm
from typing import Dict, Tuple, List

class MDPInventorySolver:
    def __init__(self, config: Dict):
        self.max_inventory = config.get('max_inventory', 100)
        self.order_cost = config.get('order_cost', 50)
        self.holding_cost = config.get('holding_cost', 2)
        self.stockout_cost = config.get('stockout_cost', 20)
        self.selling_price = config.get('selling_price', 15)
        self.demand_mean = config.get('demand_mean', 10)
        self.demand_std = config.get('demand_std', 3)
        self.gamma = config.get('gamma', 0.95)
        self.transport_costs = {
            'truck': 100,
            'ship': 50,
            'rail': 75,
            'air': 200
        }
        self.transport_times = {
            'truck': 1,
            'ship': 3,
            'rail': 2,
            'air': 0
        }
        
        self.states = list(range(self.max_inventory + 1))
        self.value_function = np.zeros(len(self.states))
        self.policy = np.zeros(len(self.states), dtype=int)
        self.q_values = np.zeros((len(self.states), self.max_inventory + 1))
        
    def demand_probability(self, d: int) -> float:
        if d < 0:
            return 0
        return norm.pdf(d, self.demand_mean, self.demand_std)
    
    def immediate_reward(self, state: int, action: int, demand: int) -> float:
        sales = min(state, demand)
        revenue = sales * self.selling_price
        holding = state * self.holding_cost
        ordering = self.order_cost + action * 5 if action > 0 else 0
        stockout = max(0, demand - state) * self.stockout_cost
        return revenue - holding - ordering - stockout
    
    def transition_probability(self, state: int, action: int, next_state: int) -> float:
        max_demand = int(self.demand_mean + 4 * self.demand_std)
        total_prob = 0
        
        for d in range(max_demand + 1):
            resulting_state = max(0, min(self.max_inventory, state + action - d))
            if resulting_state == next_state:
                total_prob += self.demand_probability(d)
        
        return total_prob
    
    def bellman_update(self, state: int) -> Tuple[float, int]:
        max_value = float('-inf')
        best_action = 0
        max_action = min(self.max_inventory - state, self.max_inventory)
        
        for action in range(max_action + 1):
            expected_value = 0
            max_demand = int(self.demand_mean + 4 * self.demand_std)
            
            for demand in range(max_demand + 1):
                prob = self.demand_probability(demand)
                reward = self.immediate_reward(state, action, demand)
                next_state = max(0, min(self.max_inventory, state + action - demand))
                expected_value += prob * (reward + self.gamma * self.value_function[next_state])
            
            self.q_values[state, action] = expected_value
            
            if expected_value > max_value:
                max_value = expected_value
                best_action = action
        
        return max_value, best_action
    
    def value_iteration(self, epsilon: float = 0.01, max_iterations: int = 1000) -> Dict:
        iteration_history = []
        
        for iteration in range(max_iterations):
            delta = 0
            old_value = self.value_function.copy()
            
            for state in self.states:
                new_value, best_action = self.bellman_update(state)
                delta = max(delta, abs(self.value_function[state] - new_value))
                self.value_function[state] = new_value
                self.policy[state] = best_action
            
            iteration_history.append({
                'iteration': iteration + 1,
                'delta': float(delta),
                'max_value': float(np.max(self.value_function)),
                'min_value': float(np.min(self.value_function))
            })
            
            if delta < epsilon:
                break
        
        return {
            'converged': delta < epsilon,
            'iterations': iteration + 1,
            'final_delta': float(delta),
            'history': iteration_history
        }
    
    def compute_s_S_policy(self) -> Tuple[int, int]:
        reorder_points = []
        order_up_to = []
        
        for state in self.states:
            if self.policy[state] > 0:
                reorder_points.append(state)
                order_up_to.append(state + self.policy[state])
        
        if reorder_points:
            s = max(reorder_points)
            S = int(np.mean(order_up_to)) if order_up_to else self.max_inventory // 2
        else:
            s = self.max_inventory // 3
            S = 2 * self.max_inventory // 3
        
        return s, S
    
    def simulate_episode(self, initial_state: int, steps: int = 100, transport_mode: str = 'truck') -> List[Dict]:
        trajectory = []
        state = initial_state
        total_reward = 0
        
        for step in range(steps):
            action = self.policy[state]
            demand = int(np.random.normal(self.demand_mean, self.demand_std))
            demand = max(0, demand)
            
            reward = self.immediate_reward(state, action, demand)
            next_state = max(0, min(self.max_inventory, state + action - demand))
            
            trajectory.append({
                'step': step,
                'state': int(state),
                'action': int(action),
                'demand': int(demand),
                'reward': float(reward),
                'next_state': int(next_state),
                'transport_mode': transport_mode,
                'transport_cost': self.transport_costs[transport_mode]
            })
            
            total_reward += reward
            state = next_state
        
        return {
            'trajectory': trajectory,
            'total_reward': float(total_reward),
            'average_reward': float(total_reward / steps)
        }
    
    def export_results(self, filename: str = 'mdp_results.json'):
        s_policy, S_policy = self.compute_s_S_policy()
        
        results = {
            'configuration': {
                'max_inventory': self.max_inventory,
                'order_cost': self.order_cost,
                'holding_cost': self.holding_cost,
                'stockout_cost': self.stockout_cost,
                'selling_price': self.selling_price,
                'demand_mean': self.demand_mean,
                'demand_std': self.demand_std,
                'gamma': self.gamma
            },
            'value_function': {str(s): float(v) for s, v in enumerate(self.value_function)},
            'policy': {str(s): int(a) for s, a in enumerate(self.policy)},
            's_S_policy': {
                's': s_policy,
                'S': S_policy
            },
            'transport_modes': {
                mode: {
                    'cost': cost,
                    'time': self.transport_times[mode]
                }
                for mode, cost in self.transport_costs.items()
            }
        }
        
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2)
        
        return results

def main():
    config = {
        'max_inventory': 100,
        'order_cost': 50,
        'holding_cost': 2,
        'stockout_cost': 20,
        'selling_price': 15,
        'demand_mean': 10,
        'demand_std': 3,
        'gamma': 0.95
    }
    
    solver = MDPInventorySolver(config)
    print("Starting Value Iteration...")
    convergence_info = solver.value_iteration()
    
    print(f"\nConvergence Info:")
    print(f"Converged: {convergence_info['converged']}")
    print(f"Iterations: {convergence_info['iterations']}")
    print(f"Final Delta: {convergence_info['final_delta']:.6f}")
    
    s, S = solver.compute_s_S_policy()
    print(f"\nOptimal (s,S) Policy: s={s}, S={S}")
    
    print("\nSample Policy (first 20 states):")
    for state in range(min(20, len(solver.states))):
        action = solver.policy[state]
        value = solver.value_function[state]
        print(f"State {state:3d}: Order {action:3d} units (Value: {value:8.2f})")
    
    simulation_results = solver.simulate_episode(initial_state=50, steps=30, transport_mode='truck')
    print(f"\nSimulation Results:")
    print(f"Total Reward: {simulation_results['total_reward']:.2f}")
    print(f"Average Reward: {simulation_results['average_reward']:.2f}")
    
    results = solver.export_results()
    print("\nResults exported to mdp_results.json")

if __name__ == "__main__":
    main()