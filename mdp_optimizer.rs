use std::collections::HashMap;
use std::f64::consts::PI;
use std::fs::File;
use std::io::Write;
use serde::{Serialize, Deserialize};
use rand::Rng;
use rand::distributions::{Distribution, Normal};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MDPConfig {
    max_inventory: usize,
    order_cost: f64,
    holding_cost: f64,
    stockout_cost: f64,
    selling_price: f64,
    demand_mean: f64,
    demand_std: f64,
    gamma: f64,
}

impl Default for MDPConfig {
    fn default() -> Self {
        MDPConfig {
            max_inventory: 100,
            order_cost: 50.0,
            holding_cost: 2.0,
            stockout_cost: 20.0,
            selling_price: 15.0,
            demand_mean: 10.0,
            demand_std: 3.0,
            gamma: 0.95,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct TransportMode {
    name: String,
    cost: f64,
    time: usize,
}

#[derive(Debug)]
struct MDPOptimizer {
    config: MDPConfig,
    value_function: Vec<f64>,
    policy: Vec<usize>,
    q_values: Vec<Vec<f64>>,
    transport_modes: Vec<TransportMode>,
}

impl MDPOptimizer {
    fn new(config: MDPConfig) -> Self {
        let size = config.max_inventory + 1;
        let transport_modes = vec![
            TransportMode { name: "truck".to_string(), cost: 100.0, time: 1 },
            TransportMode { name: "ship".to_string(), cost: 50.0, time: 3 },
            TransportMode { name: "rail".to_string(), cost: 75.0, time: 2 },
            TransportMode { name: "air".to_string(), cost: 200.0, time: 0 },
        ];

        MDPOptimizer {
            config,
            value_function: vec![0.0; size],
            policy: vec![0; size],
            q_values: vec![vec![0.0; size]; size],
            transport_modes,
        }
    }

    fn normal_pdf(&self, x: f64, mean: f64, std: f64) -> f64 {
        let exponent = -0.5 * ((x - mean) / std).powi(2);
        (1.0 / (std * (2.0 * PI).sqrt())) * exponent.exp()
    }

    fn demand_probability(&self, d: i32) -> f64 {
        if d < 0 {
            return 0.0;
        }
        self.normal_pdf(d as f64, self.config.demand_mean, self.config.demand_std)
    }

    fn immediate_reward(&self, state: usize, action: usize, demand: i32) -> f64 {
        let sales = (state as i32).min(demand) as f64;
        let revenue = sales * self.config.selling_price;
        let holding = (state as f64) * self.config.holding_cost;
        let ordering = if action > 0 {
            self.config.order_cost + (action as f64) * 5.0
        } else {
            0.0
        };
        let stockout = (0.max(demand - state as i32) as f64) * self.config.stockout_cost;
        revenue - holding - ordering - stockout
    }

    fn bellman_update(&mut self, state: usize) -> (f64, usize) {
        let mut max_value = f64::NEG_INFINITY;
        let mut best_action = 0;
        let max_action = (self.config.max_inventory - state).min(self.config.max_inventory);

        for action in 0..=max_action {
            let mut expected_value = 0.0;
            let max_demand = (self.config.demand_mean + 4.0 * self.config.demand_std) as i32;

            for demand in 0..=max_demand {
                let prob = self.demand_probability(demand);
                let reward = self.immediate_reward(state, action, demand);
                let next_state = 0.max(
                    (self.config.max_inventory as i32)
                        .min((state as i32) + (action as i32) - demand)
                ) as usize;
                expected_value += prob * (reward + self.config.gamma * self.value_function[next_state]);
            }

            self.q_values[state][action] = expected_value;

            if expected_value > max_value {
                max_value = expected_value;
                best_action = action;
            }
        }

        (max_value, best_action)
    }

    fn value_iteration(&mut self, epsilon: f64, max_iterations: usize) -> ConvergenceInfo {
        let mut convergence_info = ConvergenceInfo {
            converged: false,
            iterations: 0,
            final_delta: 0.0,
            delta_history: Vec::new(),
        };

        for iteration in 0..max_iterations {
            let mut delta = 0.0;

            for state in 0..=self.config.max_inventory {
                let old_value = self.value_function[state];
                let (new_value, best_action) = self.bellman_update(state);
                delta = delta.max((old_value - new_value).abs());
                self.value_function[state] = new_value;
                self.policy[state] = best_action;
            }

            convergence_info.delta_history.push(delta);
            convergence_info.iterations = iteration + 1;
            convergence_info.final_delta = delta;

            if delta < epsilon {
                convergence_info.converged = true;
                break;
            }
        }

        convergence_info
    }

    fn compute_s_s_policy(&self) -> (usize, usize) {
        let mut reorder_points = Vec::new();
        let mut order_up_to = Vec::new();

        for state in 0..=self.config.max_inventory {
            if self.policy[state] > 0 {
                reorder_points.push(state);
                order_up_to.push(state + self.policy[state]);
            }
        }

        let s = reorder_points.iter().max().copied().unwrap_or(self.config.max_inventory / 3);
        let S = if !order_up_to.is_empty() {
            order_up_to.iter().sum::<usize>() / order_up_to.len()
        } else {
            (2 * self.config.max_inventory) / 3
        };

        (s, S)
    }

    fn simulate_episode(&self, initial_state: usize, steps: usize, transport_mode: &str) -> SimulationResult {
        let mut rng = rand::thread_rng();
        let normal = Normal::new(self.config.demand_mean, self.config.demand_std);
        let mut trajectory = Vec::new();
        let mut state = initial_state;
        let mut total_reward = 0.0;

        let transport_cost = self.transport_modes
            .iter()
            .find(|m| m.name == transport_mode)
            .map(|m| m.cost)
            .unwrap_or(0.0);

        for step in 0..steps {
            let action = self.policy[state];
            let demand = normal.sample(&mut rng).round().max(0.0) as i32;
            let mut reward = self.immediate_reward(state, action, demand);

            if action > 0 {
                reward -= transport_cost;
            }

            let next_state = 0.max(
                (self.config.max_inventory as i32)
                    .min((state as i32) + (action as i32) - demand)
            ) as usize;

            trajectory.push(SimulationStep {
                step,
                state,
                action,
                demand: demand as usize,
                reward,
                next_state,
            });

            total_reward += reward;
            state = next_state;
        }

        SimulationResult {
            trajectory,
            total_reward,
            average_reward: total_reward / (steps as f64),
        }
    }

    fn export_results(&self, filename: &str) -> std::io::Result<()> {
        let (s, S) = self.compute_s_s_policy();
        
        let results = OptimizationResults {
            config: self.config.clone(),
            value_function: self.value_function.clone(),
            policy: self.policy.clone(),
            s_policy: s,
            S_policy: S,
            transport_modes: self.transport_modes.clone(),
        };

        let json = serde_json::to_string_pretty(&results)?;
        let mut file = File::create(filename)?;
        file.write_all(json.as_bytes())?;
        
        Ok(())
    }

    fn print_policy(&self, max_states: usize) {
        println!("\nOptimal Policy (first {} states):", max_states);
        println!("{:>8} {:>12} {:>15}", "State", "Action", "Value");
        println!("{}", "-".repeat(35));

        for state in 0..max_states.min(self.config.max_inventory + 1) {
            println!(
                "{:>8} {:>12} {:>15.2}",
                state, self.policy[state], self.value_function[state]
            );
        }
    }
}

#[derive(Debug, Serialize)]
struct ConvergenceInfo {
    converged: bool,
    iterations: usize,
    final_delta: f64,
    delta_history: Vec<f64>,
}

#[derive(Debug, Serialize)]
struct SimulationStep {
    step: usize,
    state: usize,
    action: usize,
    demand: usize,
    reward: f64,
    next_state: usize,
}

#[derive(Debug, Serialize)]
struct SimulationResult {
    trajectory: Vec<SimulationStep>,
    total_reward: f64,
    average_reward: f64,
}

#[derive(Debug, Serialize)]
struct OptimizationResults {
    config: MDPConfig,
    value_function: Vec<f64>,
    policy: Vec<usize>,
    s_policy: usize,
    S_policy: usize,
    transport_modes: Vec<TransportMode>,
}

fn main() {
    println!("=== MDP Inventory Optimizer (Rust) ===\n");

    let config = MDPConfig::default();
    let mut optimizer = MDPOptimizer::new(config);

    println!("Running Value Iteration...");
    let convergence_info = optimizer.value_iteration(0.01, 1000);

    println!("\nConvergence Information:");
    println!("  Converged: {}", convergence_info.converged);
    println!("  Iterations: {}", convergence_info.iterations);
    println!("  Final Delta: {:.6}", convergence_info.final_delta);

    let (s, S) = optimizer.compute_s_s_policy();
    println!("\nOptimal (s,S) Policy:");
    println!("  s (reorder point): {}", s);
    println!("  S (order-up-to level): {}", S);

    optimizer.print_policy(20);

    println!("\nRunning simulation (30 steps)...");
    let sim_result = optimizer.simulate_episode(50, 30, "truck");
    println!("  Total Reward: ${:.2}", sim_result.total_reward);
    println!("  Average Reward: ${:.2}", sim_result.average_reward);

    match optimizer.export_results("mdp_optimizer_results.json") {
        Ok(_) => println!("\nResults exported to mdp_optimizer_results.json"),
        Err(e) => eprintln!("Error exporting results: {}", e),
    }

    println!("\n=== Optimization Complete ===");
}