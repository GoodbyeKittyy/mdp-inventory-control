const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'mdp_inventory',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

const initDatabase = async () => {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS simulation_runs (
                id SERIAL PRIMARY KEY,
                run_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                initial_inventory INTEGER NOT NULL,
                total_days INTEGER NOT NULL,
                transport_mode VARCHAR(50),
                final_cash DECIMAL(10, 2),
                total_revenue DECIMAL(10, 2),
                total_cost DECIMAL(10, 2),
                stockouts INTEGER,
                config JSONB
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS simulation_steps (
                id SERIAL PRIMARY KEY,
                run_id INTEGER REFERENCES simulation_runs(id) ON DELETE CASCADE,
                step_number INTEGER NOT NULL,
                inventory INTEGER,
                demand INTEGER,
                action INTEGER,
                reward DECIMAL(10, 2),
                phase VARCHAR(50)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS policies (
                id SERIAL PRIMARY KEY,
                policy_name VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                s_threshold INTEGER,
                S_target INTEGER,
                config JSONB,
                policy_data JSONB
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_simulation_runs_date ON simulation_runs(run_date);
            CREATE INDEX IF NOT EXISTS idx_simulation_steps_run ON simulation_steps(run_id);
            CREATE INDEX IF NOT EXISTS idx_policies_name ON policies(policy_name);
        `);

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        client.release();
    }
};

class MDPCalculator {
    constructor(config) {
        this.maxInventory = config.maxInventory || 100;
        this.orderCost = config.orderCost || 50;
        this.holdingCost = config.holdingCost || 2;
        this.stockoutCost = config.stockoutCost || 20;
        this.sellingPrice = config.sellingPrice || 15;
        this.demandMean = config.demandMean || 10;
        this.demandStd = config.demandStd || 3;
        this.gamma = config.gamma || 0.95;
    }

    normalPDF(x, mean, std) {
        const exponent = -0.5 * Math.pow((x - mean) / std, 2);
        return (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);
    }

    demandProbability(d) {
        if (d < 0) return 0;
        return this.normalPDF(d, this.demandMean, this.demandStd);
    }

    immediateReward(state, action, demand) {
        const sales = Math.min(state, demand);
        const revenue = sales * this.sellingPrice;
        const holding = state * this.holdingCost;
        const ordering = action > 0 ? this.orderCost + action * 5 : 0;
        const stockout = Math.max(0, demand - state) * this.stockoutCost;
        return revenue - holding - ordering - stockout;
    }

    async valueIteration(epsilon = 0.01, maxIterations = 1000) {
        const valueFunction = new Array(this.maxInventory + 1).fill(0);
        const policy = new Array(this.maxInventory + 1).fill(0);
        const qValues = Array.from({ length: this.maxInventory + 1 }, () => 
            new Array(this.maxInventory + 1).fill(0)
        );

        let converged = false;
        let iterations = 0;

        for (let iter = 0; iter < maxIterations; iter++) {
            let delta = 0;

            for (let state = 0; state <= this.maxInventory; state++) {
                let maxValue = -Infinity;
                let bestAction = 0;
                const maxAction = Math.min(this.maxInventory - state, this.maxInventory);

                for (let action = 0; action <= maxAction; action++) {
                    let expectedValue = 0;
                    const maxDemand = Math.ceil(this.demandMean + 4 * this.demandStd);

                    for (let demand = 0; demand <= maxDemand; demand++) {
                        const prob = this.demandProbability(demand);
                        const reward = this.immediateReward(state, action, demand);
                        const nextState = Math.max(0, Math.min(this.maxInventory, state + action - demand));
                        expectedValue += prob * (reward + this.gamma * valueFunction[nextState]);
                    }

                    qValues[state][action] = expectedValue;

                    if (expectedValue > maxValue) {
                        maxValue = expectedValue;
                        bestAction = action;
                    }
                }

                delta = Math.max(delta, Math.abs(valueFunction[state] - maxValue));
                valueFunction[state] = maxValue;
                policy[state] = bestAction;
            }

            iterations = iter + 1;

            if (delta < epsilon) {
                converged = true;
                break;
            }
        }

        return { valueFunction, policy, qValues, converged, iterations };
    }
}

app.post('/api/compute-policy', async (req, res) => {
    try {
        const config = req.body;
        const calculator = new MDPCalculator(config);
        const result = await calculator.valueIteration();

        const reorderPoints = [];
        const orderUpTo = [];
        
        for (let state = 0; state < result.policy.length; state++) {
            if (result.policy[state] > 0) {
                reorderPoints.push(state);
                orderUpTo.push(state + result.policy[state]);
            }
        }

        const s = reorderPoints.length > 0 ? Math.max(...reorderPoints) : config.maxInventory / 3;
        const S = orderUpTo.length > 0 ? Math.round(orderUpTo.reduce((a, b) => a + b) / orderUpTo.length) : 
                  Math.round(2 * config.maxInventory / 3);

        res.json({
            success: true,
            valueFunction: result.valueFunction,
            policy: result.policy,
            sPolicy: s,
            SPolicy: S,
            converged: result.converged,
            iterations: result.iterations
        });
    } catch (error) {
        console.error('Error computing policy:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/save-policy', async (req, res) => {
    const client = await pool.connect();
    try {
        const { policyName, sThreshold, STarget, config, policyData } = req.body;

        const result = await client.query(
            `INSERT INTO policies (policy_name, s_threshold, S_target, config, policy_data)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (policy_name) 
             DO UPDATE SET s_threshold = $2, S_target = $3, config = $4, policy_data = $5, 
                          created_at = CURRENT_TIMESTAMP
             RETURNING id`,
            [policyName, sThreshold, STarget, config, policyData]
        );

        res.json({ success: true, policyId: result.rows[0].id });
    } catch (error) {
        console.error('Error saving policy:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.get('/api/policies', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT id, policy_name, s_threshold, S_target, created_at FROM policies ORDER BY created_at DESC'
        );
        res.json({ success: true, policies: result.rows });
    } catch (error) {
        console.error('Error fetching policies:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.get('/api/policy/:name', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM policies WHERE policy_name = $1',
            [req.params.name]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Policy not found' });
        }

        res.json({ success: true, policy: result.rows[0] });
    } catch (error) {
        console.error('Error fetching policy:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.post('/api/save-simulation', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { initialInventory, totalDays, transportMode, finalCash, totalRevenue, 
                totalCost, stockouts, config, steps } = req.body;

        const runResult = await client.query(
            `INSERT INTO simulation_runs 
             (initial_inventory, total_days, transport_mode, final_cash, total_revenue, total_cost, stockouts, config)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [initialInventory, totalDays, transportMode, finalCash, totalRevenue, totalCost, stockouts, config]
        );

        const runId = runResult.rows[0].id;

        for (const step of steps) {
            await client.query(
                `INSERT INTO simulation_steps (run_id, step_number, inventory, demand, action, reward, phase)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [runId, step.stepNumber, step.inventory, step.demand, step.action, step.reward, step.phase]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, runId });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error saving simulation:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.get('/api/simulations', async (req, res) => {
    const client = await pool.connect();
    try {
        const limit = parseInt(req.query.limit) || 50;
        const result = await client.query(
            `SELECT id, run_date, initial_inventory, total_days, transport_mode, 
                    final_cash, total_revenue, total_cost, stockouts
             FROM simulation_runs 
             ORDER BY run_date DESC 
             LIMIT $1`,
            [limit]
        );
        res.json({ success: true, simulations: result.rows });
    } catch (error) {
        console.error('Error fetching simulations:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.get('/api/simulation/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const runResult = await client.query(
            'SELECT * FROM simulation_runs WHERE id = $1',
            [req.params.id]
        );

        if (runResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Simulation not found' });
        }

        const stepsResult = await client.query(
            'SELECT * FROM simulation_steps WHERE run_id = $1 ORDER BY step_number',
            [req.params.id]
        );

        res.json({ 
            success: true, 
            simulation: runResult.rows[0],
            steps: stepsResult.rows
        });
    } catch (error) {
        console.error('Error fetching simulation:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.get('/api/analytics/summary', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                COUNT(*) as total_simulations,
                AVG(final_cash) as avg_final_cash,
                AVG(total_revenue) as avg_revenue,
                AVG(total_cost) as avg_cost,
                AVG(stockouts) as avg_stockouts,
                MAX(final_cash) as best_performance
            FROM simulation_runs
        `);
        res.json({ success: true, analytics: result.rows[0] });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.listen(PORT, async () => {
    console.log(`MDP Inventory Control Server running on port ${PORT}`);
    await initDatabase();
});