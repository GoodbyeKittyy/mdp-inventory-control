#include <iostream>
#include <vector>
#include <cmath>
#include <algorithm>
#include <random>
#include <fstream>
#include <iomanip>
#include <map>

class MDPEngine {
private:
    int maxInventory;
    double orderCost;
    double holdingCost;
    double stockoutCost;
    double sellingPrice;
    double demandMean;
    double demandStd;
    double gamma;
    
    std::vector<double> valueFunction;
    std::vector<int> policy;
    std::vector<std::vector<double>> qValues;
    
    std::random_device rd;
    std::mt19937 gen;
    std::normal_distribution<double> demandDist;
    
    struct TransportMode {
        double cost;
        int time;
    };
    
    std::map<std::string, TransportMode> transportModes;

public:
    MDPEngine(int maxInv, double ordCost, double holdCost, double stockCost, 
              double sellPrice, double demMean, double demStd, double discountFactor)
        : maxInventory(maxInv), orderCost(ordCost), holdingCost(holdCost),
          stockoutCost(stockCost), sellingPrice(sellPrice), demandMean(demMean),
          demandStd(demStd), gamma(discountFactor), gen(rd()), 
          demandDist(demandMean, demandStd) {
        
        valueFunction.resize(maxInventory + 1, 0.0);
        policy.resize(maxInventory + 1, 0);
        qValues.resize(maxInventory + 1, std::vector<double>(maxInventory + 1, 0.0));
        
        transportModes["truck"] = {100.0, 1};
        transportModes["ship"] = {50.0, 3};
        transportModes["rail"] = {75.0, 2};
        transportModes["air"] = {200.0, 0};
    }
    
    double normalPDF(double x, double mean, double std) {
        const double PI = 3.14159265358979323846;
        double exponent = -0.5 * std::pow((x - mean) / std, 2);
        return (1.0 / (std * std::sqrt(2 * PI))) * std::exp(exponent);
    }
    
    double demandProbability(int d) {
        if (d < 0) return 0.0;
        return normalPDF(static_cast<double>(d), demandMean, demandStd);
    }
    
    double immediateReward(int state, int action, int demand) {
        int sales = std::min(state, demand);
        double revenue = sales * sellingPrice;
        double holding = state * holdingCost;
        double ordering = (action > 0) ? (orderCost + action * 5.0) : 0.0;
        double stockout = std::max(0, demand - state) * stockoutCost;
        return revenue - holding - ordering - stockout;
    }
    
    std::pair<double, int> bellmanUpdate(int state) {
        double maxValue = -std::numeric_limits<double>::infinity();
        int bestAction = 0;
        int maxAction = std::min(maxInventory - state, maxInventory);
        
        for (int action = 0; action <= maxAction; ++action) {
            double expectedValue = 0.0;
            int maxDemand = static_cast<int>(demandMean + 4 * demandStd);
            
            for (int demand = 0; demand <= maxDemand; ++demand) {
                double prob = demandProbability(demand);
                double reward = immediateReward(state, action, demand);
                int nextState = std::max(0, std::min(maxInventory, state + action - demand));
                expectedValue += prob * (reward + gamma * valueFunction[nextState]);
            }
            
            qValues[state][action] = expectedValue;
            
            if (expectedValue > maxValue) {
                maxValue = expectedValue;
                bestAction = action;
            }
        }
        
        return {maxValue, bestAction};
    }
    
    struct ConvergenceInfo {
        bool converged;
        int iterations;
        double finalDelta;
        std::vector<double> deltaHistory;
    };
    
    ConvergenceInfo valueIteration(double epsilon = 0.01, int maxIterations = 1000) {
        ConvergenceInfo info;
        info.converged = false;
        info.iterations = 0;
        
        for (int iteration = 0; iteration < maxIterations; ++iteration) {
            double delta = 0.0;
            
            for (int state = 0; state <= maxInventory; ++state) {
                auto [newValue, bestAction] = bellmanUpdate(state);
                delta = std::max(delta, std::abs(valueFunction[state] - newValue));
                valueFunction[state] = newValue;
                policy[state] = bestAction;
            }
            
            info.deltaHistory.push_back(delta);
            info.iterations = iteration + 1;
            info.finalDelta = delta;
            
            if (delta < epsilon) {
                info.converged = true;
                break;
            }
        }
        
        return info;
    }
    
    std::pair<int, int> computeSSpolicy() {
        std::vector<int> reorderPoints;
        std::vector<int> orderUpTo;
        
        for (int state = 0; state <= maxInventory; ++state) {
            if (policy[state] > 0) {
                reorderPoints.push_back(state);
                orderUpTo.push_back(state + policy[state]);
            }
        }
        
        int s = reorderPoints.empty() ? maxInventory / 3 : *std::max_element(reorderPoints.begin(), reorderPoints.end());
        int S = orderUpTo.empty() ? (2 * maxInventory / 3) : 
                std::accumulate(orderUpTo.begin(), orderUpTo.end(), 0) / orderUpTo.size();
        
        return {s, S};
    }
    
    int generateDemand() {
        int demand = static_cast<int>(std::round(demandDist(gen)));
        return std::max(0, demand);
    }
    
    struct SimulationStep {
        int step;
        int state;
        int action;
        int demand;
        double reward;
        int nextState;
    };
    
    struct SimulationResult {
        std::vector<SimulationStep> trajectory;
        double totalReward;
        double averageReward;
    };
    
    SimulationResult simulateEpisode(int initialState, int steps, const std::string& transportMode) {
        SimulationResult result;
        int state = initialState;
        double totalReward = 0.0;
        
        for (int step = 0; step < steps; ++step) {
            int action = policy[state];
            int demand = generateDemand();
            double reward = immediateReward(state, action, demand);
            
            if (action > 0 && transportModes.find(transportMode) != transportModes.end()) {
                reward -= transportModes[transportMode].cost;
            }
            
            int nextState = std::max(0, std::min(maxInventory, state + action - demand));
            
            result.trajectory.push_back({step, state, action, demand, reward, nextState});
            totalReward += reward;
            state = nextState;
        }
        
        result.totalReward = totalReward;
        result.averageReward = totalReward / steps;
        
        return result;
    }
    
    void exportResults(const std::string& filename) {
        std::ofstream outFile(filename);
        
        if (!outFile.is_open()) {
            std::cerr << "Error opening file: " << filename << std::endl;
            return;
        }
        
        auto [s, S] = computeSSpolicy();
        
        outFile << "MDP Inventory Control - Results\n";
        outFile << "================================\n\n";
        outFile << "Configuration:\n";
        outFile << "  Max Inventory: " << maxInventory << "\n";
        outFile << "  Order Cost: $" << orderCost << "\n";
        outFile << "  Holding Cost: $" << holdingCost << " per unit\n";
        outFile << "  Stockout Cost: $" << stockoutCost << " per unit\n";
        outFile << "  Selling Price: $" << sellingPrice << "\n";
        outFile << "  Demand Mean: " << demandMean << "\n";
        outFile << "  Demand Std: " << demandStd << "\n";
        outFile << "  Discount Factor: " << gamma << "\n\n";
        
        outFile << "Optimal (s,S) Policy:\n";
        outFile << "  s (reorder point): " << s << "\n";
        outFile << "  S (order-up-to): " << S << "\n\n";
        
        outFile << "Policy (State -> Action):\n";
        outFile << std::setw(8) << "State" << std::setw(12) << "Action" << std::setw(15) << "Value\n";
        outFile << std::string(35, '-') << "\n";
        
        for (int state = 0; state <= std::min(30, maxInventory); ++state) {
            outFile << std::setw(8) << state 
                    << std::setw(12) << policy[state]
                    << std::setw(15) << std::fixed << std::setprecision(2) << valueFunction[state] << "\n";
        }
        
        outFile << "\nTransport Modes:\n";
        for (const auto& [mode, data] : transportModes) {
            outFile << "  " << mode << ": Cost=$" << data.cost << ", Time=" << data.time << " days\n";
        }
        
        outFile.close();
        std::cout << "Results exported to " << filename << std::endl;
    }
    
    void printPolicy(int maxStates = 20) {
        std::cout << "\nOptimal Policy (first " << maxStates << " states):\n";
        std::cout << std::setw(8) << "State" << std::setw(12) << "Action" << std::setw(15) << "Value\n";
        std::cout << std::string(35, '-') << "\n";
        
        for (int state = 0; state < std::min(maxStates, maxInventory + 1); ++state) {
            std::cout << std::setw(8) << state 
                      << std::setw(12) << policy[state]
                      << std::setw(15) << std::fixed << std::setprecision(2) << valueFunction[state] << "\n";
        }
    }
};

int main() {
    std::cout << "=== MDP Inventory Control Engine ===" << std::endl;
    std::cout << "Initializing solver..." << std::endl;
    
    MDPEngine engine(100, 50.0, 2.0, 20.0, 15.0, 10.0, 3.0, 0.95);
    
    std::cout << "Running Value Iteration..." << std::endl;
    auto convergenceInfo = engine.valueIteration(0.01, 1000);
    
    std::cout << "\nConvergence Information:" << std::endl;
    std::cout << "  Converged: " << (convergenceInfo.converged ? "Yes" : "No") << std::endl;
    std::cout << "  Iterations: " << convergenceInfo.iterations << std::endl;
    std::cout << "  Final Delta: " << convergenceInfo.finalDelta << std::endl;
    
    auto [s, S] = engine.computeSSpolicy();
    std::cout << "\nOptimal (s,S) Policy:" << std::endl;
    std::cout << "  s (reorder point): " << s << std::endl;
    std::cout << "  S (order-up-to level): " << S << std::endl;
    
    engine.printPolicy(20);
    
    std::cout << "\nRunning simulation (30 steps)..." << std::endl;
    auto simResult = engine.simulateEpisode(50, 30, "truck");
    std::cout << "  Total Reward: $" << std::fixed << std::setprecision(2) << simResult.totalReward << std::endl;
    std::cout << "  Average Reward: $" << simResult.averageReward << std::endl;
    
    engine.exportResults("mdp_engine_results.txt");
    
    std::cout << "\n=== Execution Complete ===" << std::endl;
    
    return 0;
}