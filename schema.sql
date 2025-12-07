-- MDP Inventory Control Game - PostgreSQL Database Schema

-- Drop existing tables if they exist
DROP TABLE IF EXISTS simulation_steps CASCADE;
DROP TABLE IF EXISTS simulation_runs CASCADE;
DROP TABLE IF EXISTS policies CASCADE;
DROP TABLE IF EXISTS transport_modes CASCADE;
DROP TABLE IF EXISTS demand_forecasts CASCADE;
DROP TABLE IF EXISTS inventory_transactions CASCADE;

-- Create transport modes lookup table
CREATE TABLE transport_modes (
    id SERIAL PRIMARY KEY,
    mode_name VARCHAR(50) UNIQUE NOT NULL,
    cost DECIMAL(10, 2) NOT NULL,
    transit_time INTEGER NOT NULL,
    reliability_score DECIMAL(3, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create policies table to store optimal MDP policies
CREATE TABLE policies (
    id SERIAL PRIMARY KEY,
    policy_name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    s_threshold INTEGER NOT NULL,
    S_target INTEGER NOT NULL,
    max_inventory INTEGER NOT NULL,
    config JSONB NOT NULL,
    policy_data JSONB NOT NULL,
    value_function JSONB,
    converged BOOLEAN DEFAULT FALSE,
    iterations INTEGER
);

-- Create simulation runs table
CREATE TABLE simulation_runs (
    id SERIAL PRIMARY KEY,
    run_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    policy_id INTEGER REFERENCES policies(id) ON DELETE SET NULL,
    initial_inventory INTEGER NOT NULL,
    initial_cash DECIMAL(10, 2) NOT NULL,
    total_days INTEGER NOT NULL,
    transport_mode_id INTEGER REFERENCES transport_modes(id),
    transport_mode VARCHAR(50),
    final_inventory INTEGER,
    final_cash DECIMAL(10, 2),
    total_revenue DECIMAL(10, 2),
    total_cost DECIMAL(10, 2),
    net_profit DECIMAL(10, 2),
    stockouts INTEGER DEFAULT 0,
    service_level DECIMAL(5, 4),
    inventory_turnover DECIMAL(6, 2),
    config JSONB,
    completed BOOLEAN DEFAULT FALSE
);

-- Create simulation steps table for detailed tracking
CREATE TABLE simulation_steps (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES simulation_runs(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    day INTEGER NOT NULL,
    phase VARCHAR(50) NOT NULL,
    inventory_start INTEGER NOT NULL,
    inventory_end INTEGER NOT NULL,
    demand INTEGER NOT NULL,
    demand_forecast INTEGER,
    action INTEGER NOT NULL,
    order_placed INTEGER,
    order_received INTEGER,
    sales INTEGER NOT NULL,
    revenue DECIMAL(10, 2) NOT NULL,
    holding_cost DECIMAL(10, 2) NOT NULL,
    ordering_cost DECIMAL(10, 2) NOT NULL,
    stockout_cost DECIMAL(10, 2) NOT NULL,
    transport_cost DECIMAL(10, 2),
    reward DECIMAL(10, 2) NOT NULL,
    cumulative_reward DECIMAL(10, 2),
    cash_balance DECIMAL(10, 2),
    stockout_occurred BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, step_number)
);

-- Create demand forecasts table
CREATE TABLE demand_forecasts (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES simulation_runs(id) ON DELETE CASCADE,
    forecast_day INTEGER NOT NULL,
    forecasted_demand INTEGER NOT NULL,
    actual_demand INTEGER,
    forecast_error INTEGER,
    forecast_method VARCHAR(50),
    confidence_interval JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create inventory transactions table for detailed audit trail
CREATE TABLE inventory_transactions (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES simulation_runs(id) ON DELETE CASCADE,
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    transaction_type VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cost DECIMAL(10, 2),
    total_cost DECIMAL(10, 2),
    inventory_level_before INTEGER,
    inventory_level_after INTEGER,
    transport_mode VARCHAR(50),
    supplier_id INTEGER,
    notes TEXT
);

-- Create indexes for better query performance
CREATE INDEX idx_simulation_runs_date ON simulation_runs(run_date DESC);
CREATE INDEX idx_simulation_runs_policy ON simulation_runs(policy_id);
CREATE INDEX idx_simulation_runs_transport ON simulation_runs(transport_mode);
CREATE INDEX idx_simulation_steps_run ON simulation_steps(run_id);
CREATE INDEX idx_simulation_steps_step ON simulation_steps(run_id, step_number);
CREATE INDEX idx_policies_name ON policies(policy_name);
CREATE INDEX idx_demand_forecasts_run ON demand_forecasts(run_id);
CREATE INDEX idx_inventory_transactions_run ON inventory_transactions(run_id);

-- Insert default transport modes
INSERT INTO transport_modes (mode_name, cost, transit_time, reliability_score) VALUES
    ('truck', 100.00, 1, 0.95),
    ('ship', 50.00, 3, 0.90),
    ('rail', 75.00, 2, 0.92),
    ('air', 200.00, 0, 0.98);

-- Create view for simulation performance metrics
CREATE OR REPLACE VIEW simulation_performance AS
SELECT 
    sr.id,
    sr.run_date,
    sr.policy_id,
    p.policy_name,
    sr.transport_mode,
    sr.total_days,
    sr.initial_cash,
    sr.final_cash,
    sr.total_revenue,
    sr.total_cost,
    sr.net_profit,
    sr.stockouts,
    sr.service_level,
    sr.inventory_turnover,
    (sr.final_cash - sr.initial_cash) as profit_change,
    ROUND((sr.final_cash - sr.initial_cash) / sr.initial_cash * 100, 2) as roi_percentage,
    ROUND(sr.total_revenue / NULLIF(sr.total_days, 0), 2) as avg_daily_revenue,
    ROUND(sr.total_cost / NULLIF(sr.total_days, 0), 2) as avg_daily_cost
FROM simulation_runs sr
LEFT JOIN policies p ON sr.policy_id = p.id
WHERE sr.completed = TRUE;

-- Create view for aggregate statistics by transport mode
CREATE OR REPLACE VIEW transport_mode_analytics AS
SELECT 
    transport_mode,
    COUNT(*) as simulation_count,
    AVG(final_cash) as avg_final_cash,
    AVG(total_revenue) as avg_revenue,
    AVG(total_cost) as avg_cost,
    AVG(net_profit) as avg_profit,
    AVG(stockouts) as avg_stockouts,
    AVG(service_level) as avg_service_level,
    AVG(inventory_turnover) as avg_turnover,
    MAX(net_profit) as best_profit,
    MIN(net_profit) as worst_profit
FROM simulation_runs
WHERE completed = TRUE
GROUP BY transport_mode;

-- Create view for daily aggregated metrics
CREATE OR REPLACE VIEW daily_metrics AS
SELECT 
    run_id,
    day,
    AVG(inventory_start) as avg_inventory,
    SUM(demand) as total_demand,
    SUM(sales) as total_sales,
    SUM(revenue) as total_revenue,
    SUM(holding_cost + ordering_cost + stockout_cost + COALESCE(transport_cost, 0)) as total_costs,
    SUM(reward) as total_reward,
    COUNT(CASE WHEN stockout_occurred THEN 1 END) as stockout_count
FROM simulation_steps
GROUP BY run_id, day
ORDER BY run_id, day;

-- Create function to calculate policy effectiveness
CREATE OR REPLACE FUNCTION calculate_policy_effectiveness(policy_id_param INTEGER)
RETURNS TABLE (
    total_simulations INTEGER,
    avg_profit DECIMAL(10, 2),
    avg_service_level DECIMAL(5, 4),
    avg_turnover DECIMAL(6, 2),
    success_rate DECIMAL(5, 4)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as total_simulations,
        AVG(net_profit) as avg_profit,
        AVG(service_level) as avg_service_level,
        AVG(inventory_turnover) as avg_turnover,
        (COUNT(CASE WHEN net_profit > 0 THEN 1 END)::DECIMAL / NULLIF(COUNT(*), 0)) as success_rate
    FROM simulation_runs
    WHERE policy_id = policy_id_param AND completed = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create function to update simulation completion status
CREATE OR REPLACE FUNCTION update_simulation_completion()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE simulation_runs
    SET 
        completed = TRUE,
        final_inventory = (
            SELECT inventory_end 
            FROM simulation_steps 
            WHERE run_id = NEW.run_id 
            ORDER BY step_number DESC 
            LIMIT 1
        ),
        net_profit = total_revenue - total_cost,
        service_level = 1.0 - (stockouts::DECIMAL / NULLIF(total_days, 0))
    WHERE id = NEW.run_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update simulation status
CREATE TRIGGER simulation_step_completion
    AFTER INSERT ON simulation_steps
    FOR EACH ROW
    EXECUTE FUNCTION update_simulation_completion();

-- Create function to get optimal action for a state
CREATE OR REPLACE FUNCTION get_optimal_action(
    policy_name_param VARCHAR(100),
    state_param INTEGER
)
RETURNS INTEGER AS $$
DECLARE
    action INTEGER;
BEGIN
    SELECT (policy_data->state_param::text)::INTEGER INTO action
    FROM policies
    WHERE policy_name = policy_name_param;
    
    RETURN COALESCE(action, 0);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO your_user;

-- Insert sample policy for testing
INSERT INTO policies (
    policy_name, 
    s_threshold, 
    S_target, 
    max_inventory,
    config,
    policy_data,
    converged,
    iterations
) VALUES (
    'default_policy',
    30,
    70,
    100,
    '{"order_cost": 50, "holding_cost": 2, "stockout_cost": 20, "selling_price": 15, "demand_mean": 10, "demand_std": 3, "gamma": 0.95}'::jsonb,
    '{}'::jsonb,
    TRUE,
    150
);

-- Create materialized view for analytics dashboard
CREATE MATERIALIZED VIEW analytics_dashboard AS
SELECT 
    COUNT(DISTINCT sr.id) as total_simulations,
    COUNT(DISTINCT sr.policy_id) as unique_policies,
    AVG(sr.net_profit) as avg_profit,
    STDDEV(sr.net_profit) as profit_std,
    AVG(sr.service_level) as avg_service_level,
    AVG(sr.stockouts) as avg_stockouts,
    AVG(sr.inventory_turnover) as avg_turnover,
    MAX(sr.net_profit) as best_profit,
    MIN(sr.net_profit) as worst_profit,
    (SELECT mode_name FROM transport_modes tm 
     INNER JOIN simulation_runs sr2 ON sr2.transport_mode_id = tm.id
     GROUP BY tm.mode_name 
     ORDER BY AVG(sr2.net_profit) DESC 
     LIMIT 1) as best_transport_mode
FROM simulation_runs sr
WHERE sr.completed = TRUE;

-- Create index on materialized view
CREATE UNIQUE INDEX ON analytics_dashboard ((1));

COMMENT ON TABLE simulation_runs IS 'Stores high-level information about each simulation run';
COMMENT ON TABLE simulation_steps IS 'Stores detailed step-by-step information for each simulation';
COMMENT ON TABLE policies IS 'Stores computed MDP policies with value functions';
COMMENT ON TABLE transport_modes IS 'Reference table for available transportation modes';
COMMENT ON TABLE demand_forecasts IS 'Stores demand forecasts and actual values for analysis';
COMMENT ON TABLE inventory_transactions IS 'Detailed audit trail of all inventory movements';